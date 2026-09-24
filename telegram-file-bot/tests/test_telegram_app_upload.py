from pathlib import Path
import threading
import time

from telegram_app_upload import (
    MAX_PARALLEL_PARTS,
    PART_RETRY_LIMIT,
    PART_SIZE,
    TelegramAppUploader,
    TelegramPathJobWorker,
    TelegramUploadIntentStore,
)


class FakeResponse:
    def __init__(self, payload=None, status_code=200, headers=None):
        self.payload = payload or {}
        self.status_code = status_code
        self.ok = 200 <= status_code < 300
        self.headers = headers or {}

    def json(self):
        return self.payload

    def raise_for_status(self):
        if not self.ok:
            raise RuntimeError(f"HTTP {self.status_code}")


class FakeSession:
    def __init__(self):
        self.posts = []
        self.puts = []

    def post(self, url, json, timeout):
        self.posts.append((url, json, timeout))
        action = url.rsplit("/", 1)[-1]
        if action == "create":
            return FakeResponse({"mediaId": "a" * 32, "uploadId": "upload-1", "key": "ads/file.mp4"}, 201)
        if action == "part":
            return FakeResponse({"uploadUrl": f"https://r2.test/part/{json['partNumber']}"})
        if action == "complete":
            return FakeResponse({"mediaId": "a" * 32, "name": "video.mp4", "sizeBytes": 10}, 201)
        return FakeResponse({"aborted": True})

    def put(self, url, data, timeout):
        self.puts.append((url, data, timeout))
        return FakeResponse(headers={"etag": f'"etag-{len(self.puts)}"'})


def test_default_part_size_balances_progress_and_request_count():
    assert PART_SIZE == 8 * 1024 * 1024
    assert MAX_PARALLEL_PARTS == 4
    assert PART_RETRY_LIMIT == 3


def test_uploader_never_exceeds_four_parallel_uploads():
    uploader = TelegramAppUploader("https://app.test/", max_workers=999)

    assert uploader._max_workers == 4


def test_uploads_file_in_parts_and_completes_media(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"0123456789")
    session = FakeSession()
    uploader = TelegramAppUploader("https://app.test/", session=session, part_size=4, max_workers=1)
    progress = []

    result = uploader.upload(
        str(source),
        "intent-code",
        on_progress=lambda uploaded, total: progress.append((uploaded, total)),
    )

    assert result["mediaId"] == "a" * 32
    assert [len(entry[1]) for entry in session.puts] == [4, 4, 2]
    assert session.posts[-1][1]["parts"] == [
        {"partNumber": 1, "etag": '"etag-1"'},
        {"partNumber": 2, "etag": '"etag-2"'},
        {"partNumber": 3, "etag": '"etag-3"'},
    ]
    assert progress == [(0, 10), (4, 10), (8, 10), (10, 10)]


def test_uploads_mov_as_quicktime_video(tmp_path: Path):
    source = tmp_path / "quảng-cáo.MOV"
    source.write_bytes(b"quicktime")
    session = FakeSession()
    uploader = TelegramAppUploader("https://app.test/", session=session, part_size=16, max_workers=1)

    uploader.upload(str(source), "intent-code")

    create_request = next(payload for url, payload, _ in session.posts if url.endswith("/create"))
    assert create_request["name"] == "quảng-cáo.MOV"
    assert create_request["mimeType"] == "video/quicktime"


def test_uploads_up_to_four_parts_in_parallel_and_completes_in_part_order(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"abcdefghijklmnopqrst")

    class ParallelSession(FakeSession):
        def __init__(self):
            super().__init__()
            self.lock = threading.Lock()
            self.active = 0
            self.max_active = 0

        def put(self, url, data, timeout):
            part_number = int(url.rsplit("/", 1)[-1])
            with self.lock:
                self.active += 1
                self.max_active = max(self.max_active, self.active)
            time.sleep(0.03)
            with self.lock:
                self.active -= 1
                self.puts.append((url, data, timeout))
            return FakeResponse(headers={"etag": f'"etag-{part_number}"'})

    session = ParallelSession()
    uploader = TelegramAppUploader(
        "https://app.test/",
        session=session,
        part_size=4,
        max_workers=4,
    )

    uploader.upload(str(source), "intent-code")

    assert session.max_active == 4
    assert session.posts[-1][1]["parts"] == [
        {"partNumber": 1, "etag": '"etag-1"'},
        {"partNumber": 2, "etag": '"etag-2"'},
        {"partNumber": 3, "etag": '"etag-3"'},
        {"partNumber": 4, "etag": '"etag-4"'},
        {"partNumber": 5, "etag": '"etag-5"'},
    ]


def test_retries_transient_part_errors_and_reports_progress_only_after_etag(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")

    class RetrySession(FakeSession):
        def __init__(self):
            super().__init__()
            self.statuses = [502, 503, 200]

        def put(self, url, data, timeout):
            self.puts.append((url, data, timeout))
            status = self.statuses.pop(0)
            headers = {"etag": '"etag-retried"'} if status == 200 else {}
            return FakeResponse(status_code=status, headers=headers)

    session = RetrySession()
    sleeps = []
    progress = []
    uploader = TelegramAppUploader(
        "https://app.test/",
        session=session,
        part_size=8,
        max_workers=1,
        retry_limit=3,
        retry_base_delay=2,
        sleep_impl=sleeps.append,
    )

    uploader.upload(
        str(source),
        "intent-code",
        on_progress=lambda uploaded, total: progress.append((uploaded, total)),
    )

    assert len(session.puts) == 3
    assert sleeps == [2, 4]
    assert progress == [(0, 5), (5, 5)]
    part_requests = [entry for entry in session.posts if entry[0].endswith("/part")]
    assert len(part_requests) == 3


def test_does_not_retry_a_permanent_part_error(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")

    class RejectedSession(FakeSession):
        def put(self, url, data, timeout):
            self.puts.append((url, data, timeout))
            return FakeResponse(status_code=403)

    session = RejectedSession()
    sleeps = []
    uploader = TelegramAppUploader(
        "https://app.test/",
        session=session,
        max_workers=1,
        retry_limit=3,
        sleep_impl=sleeps.append,
    )

    try:
        uploader.upload(str(source), "intent-code")
    except Exception as exc:
        assert "HTTP 403" in str(exc)
    else:
        raise AssertionError("Lỗi HTTP 403 phải làm lượt tải thất bại")

    assert len(session.puts) == 1
    assert sleeps == []


def test_intent_store_consumes_only_the_next_file():
    store = TelegramUploadIntentStore()
    store.set(123, "code-1")

    assert store.has(123)
    assert store.pop(123) == "code-1"
    assert store.pop(123) is None


def test_path_worker_claims_app_job_uploads_and_reports_completion(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")

    class WorkerSession:
        def __init__(self):
            self.calls = []

        def post(self, url, json, headers, timeout):
            self.calls.append((url, json, headers, timeout))
            if url.endswith("/claim"):
                return FakeResponse({
                    "jobId": "job-1",
                    "mediaId": "a" * 32,
                    "path": str(source),
                    "code": "intent-1",
                    "leaseToken": "lease-1",
                })
            return FakeResponse({"ok": True})

    class WorkerUploader:
        def __init__(self):
            self.calls = []

        def upload(self, path, code, on_progress=None):
            self.calls.append((path, code))
            on_progress(0, 5)
            on_progress(5, 5)
            return {"mediaId": "a" * 32}

    session = WorkerSession()
    uploader = WorkerUploader()
    worker = TelegramPathJobWorker(
        "https://app.test",
        "worker-secret",
        str(tmp_path),
        uploader,
        session=session,
        poll_interval=0,
    )

    assert worker.run_once() is True
    assert uploader.calls == [(str(source), "intent-1")]
    assert session.calls[-1][1]["status"] == "completed"
    progress_calls = [call for call in session.calls if call[0].endswith("/progress")]
    assert [call[1]["uploadedBytes"] for call in progress_calls] == [0, 5]
    assert all(call[1]["totalBytes"] == 5 for call in progress_calls)
    assert session.calls[0][2]["Authorization"] == "Bearer worker-secret"
