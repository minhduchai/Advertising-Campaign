"""Tải file từ ổ mạng lên ứng dụng bằng phiên được mở từ Telegram."""

from __future__ import annotations

import mimetypes
import logging
import os
import threading
import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait

import requests


PART_SIZE = 8 * 1024 * 1024
MAX_PARALLEL_PARTS = 4
PART_RETRY_LIMIT = 3
RETRY_BASE_DELAY_SECONDS = 2
MAX_APP_FILE_BYTES = 500 * 1024 * 1024
TRANSIENT_UPLOAD_STATUS_CODES = {408, 425, 429, 500, 502, 503, 504}


class TelegramAppUploadError(RuntimeError):
    """Lỗi tải file từ bot Telegram lên ứng dụng."""


class RetryableTelegramAppUploadError(TelegramAppUploadError):
    """Lỗi tạm thời của một phần file có thể thử lại an toàn."""


class TelegramAppUploader:
    def __init__(
        self,
        app_url: str,
        session=None,
        part_size: int = PART_SIZE,
        max_workers: int = MAX_PARALLEL_PARTS,
        retry_limit: int = PART_RETRY_LIMIT,
        retry_base_delay: float = RETRY_BASE_DELAY_SECONDS,
        upload_session_factory=None,
        sleep_impl=time.sleep,
    ):
        self._base = app_url.rstrip("/")
        self._session = session or requests.Session()
        self._part_size = int(part_size)
        self._max_workers = min(MAX_PARALLEL_PARTS, max(1, int(max_workers)))
        self._retry_limit = max(0, int(retry_limit))
        self._retry_base_delay = max(0, float(retry_base_delay))
        self._sleep = sleep_impl
        self._control_lock = threading.Lock()
        self._thread_local = threading.local()
        if upload_session_factory is not None:
            self._upload_session_factory = upload_session_factory
        elif session is not None:
            self._upload_session_factory = lambda: session
        else:
            self._upload_session_factory = requests.Session

    @staticmethod
    def _json(response) -> dict:
        try:
            payload = response.json()
        except ValueError as exc:
            raise TelegramAppUploadError("Ứng dụng trả về dữ liệu không hợp lệ.") from exc
        if not response.ok:
            raise TelegramAppUploadError(payload.get("error") or f"Ứng dụng báo HTTP {response.status_code}.")
        return payload

    def _post(self, action: str, body: dict) -> dict:
        with self._control_lock:
            response = self._session.post(
                f"{self._base}/api/telegram-upload/r2-multipart/{action}",
                json=body,
                timeout=30,
            )
        return self._json(response)

    def _upload_session(self):
        session = getattr(self._thread_local, "upload_session", None)
        if session is None:
            session = self._upload_session_factory()
            self._thread_local.upload_session = session
        return session

    def _upload_part(self, identity: dict, part_number: int, chunk: bytes) -> dict:
        last_error = None
        for retry_number in range(self._retry_limit + 1):
            try:
                signed = self._post("part", {**identity, "partNumber": part_number})
                uploaded = self._upload_session().put(
                    signed["uploadUrl"],
                    data=chunk,
                    timeout=(30, 7200),
                )
                status_code = int(getattr(uploaded, "status_code", 0) or 0)
                if status_code in TRANSIENT_UPLOAD_STATUS_CODES:
                    raise RetryableTelegramAppUploadError(
                        f"Cloudflare tạm thời trả về HTTP {status_code} cho phần {part_number}."
                    )
                if not 200 <= status_code < 300:
                    raise TelegramAppUploadError(
                        f"Cloudflare từ chối phần {part_number} với HTTP {status_code}."
                    )
                etag = uploaded.headers.get("etag") or uploaded.headers.get("ETag")
                if not etag:
                    raise RetryableTelegramAppUploadError(
                        f"Cloudflare chưa xác nhận ETag cho phần {part_number}."
                    )
                return {"partNumber": part_number, "etag": etag}
            except (requests.RequestException, RetryableTelegramAppUploadError) as exc:
                last_error = exc
                if retry_number >= self._retry_limit:
                    break
                self._sleep(self._retry_base_delay * (2 ** retry_number))
        detail = (
            last_error.__class__.__name__
            if isinstance(last_error, requests.RequestException)
            else str(last_error)
        )
        raise TelegramAppUploadError(
            f"Không thể tải phần {part_number} sau {self._retry_limit + 1} lần thử: {detail}"
        ) from last_error

    def upload(self, path: str, code: str, on_progress=None) -> dict:
        size_bytes = os.path.getsize(path)
        if size_bytes < 1 or size_bytes > MAX_APP_FILE_BYTES:
            raise TelegramAppUploadError("Ứng dụng chỉ nhận file từ 1 byte đến 500 MB.")
        name = os.path.basename(path)
        mime_type = mimetypes.guess_type(name)[0] or "application/octet-stream"
        if not (mime_type.startswith("image/") or mime_type.startswith("video/")):
            raise TelegramAppUploadError("Ứng dụng chỉ nhận ảnh hoặc video.")

        multipart = self._post("create", {
            "code": code,
            "name": name,
            "mimeType": mime_type,
            "sizeBytes": size_bytes,
        })
        identity = {
            "code": code,
            "mediaId": multipart["mediaId"],
            "uploadId": multipart["uploadId"],
            "key": multipart["key"],
        }
        parts = []
        try:
            if on_progress:
                on_progress(0, size_bytes)
            with open(path, "rb") as source:
                uploaded_bytes = 0
                next_part_number = 1
                pending = {}
                with ThreadPoolExecutor(max_workers=self._max_workers) as executor:
                    while len(pending) < self._max_workers:
                        chunk = source.read(self._part_size)
                        if not chunk:
                            break
                        future = executor.submit(self._upload_part, identity, next_part_number, chunk)
                        pending[future] = len(chunk)
                        next_part_number += 1

                    while pending:
                        completed, _ = wait(pending, return_when=FIRST_COMPLETED)
                        for future in completed:
                            chunk_size = pending.pop(future)
                            parts.append(future.result())
                            uploaded_bytes += chunk_size
                            if on_progress:
                                on_progress(uploaded_bytes, size_bytes)

                            chunk = source.read(self._part_size)
                            if chunk:
                                future = executor.submit(self._upload_part, identity, next_part_number, chunk)
                                pending[future] = len(chunk)
                                next_part_number += 1
            parts.sort(key=lambda part: part["partNumber"])
            return self._post("complete", {
                **identity,
                "name": name,
                "mimeType": mime_type,
                "sizeBytes": size_bytes,
                "parts": parts,
            })
        except Exception:
            try:
                self._post("abort", identity)
            except Exception:
                pass
            raise


class TelegramUploadIntentStore:
    """Giữ phiên ứng dụng cho đúng một file kế tiếp của mỗi người dùng Telegram."""

    def __init__(self):
        self._codes: dict[int, str] = {}

    def set(self, user_id: int, code: str) -> None:
        self._codes[int(user_id)] = code

    def pop(self, user_id: int) -> str | None:
        return self._codes.pop(int(user_id), None)

    def has(self, user_id: int) -> bool:
        return int(user_id) in self._codes


class TelegramPathJobWorker:
    """Nhận đường dẫn được nhập trong app và giao file cho uploader trên máy công ty."""

    def __init__(
        self,
        app_url: str,
        worker_secret: str,
        file_root: str,
        uploader: TelegramAppUploader,
        session=None,
        poll_interval: float = 3.0,
    ):
        self._base = app_url.rstrip("/")
        self._secret = worker_secret
        self._file_root = file_root
        self._uploader = uploader
        self._session = session or requests.Session()
        self._poll_interval = poll_interval

    def _post(self, route: str, body: dict | None = None):
        return self._session.post(
            f"{self._base}/api/telegram-upload/jobs/{route}",
            json=body or {},
            headers={"Authorization": f"Bearer {self._secret}"},
            timeout=30,
        )

    def claim(self) -> dict | None:
        response = self._post("claim")
        if response.status_code == 204:
            return None
        return TelegramAppUploader._json(response)

    def finish(self, job: dict, status: str, error: str = "") -> None:
        response = self._post("result", {
            "jobId": job["jobId"],
            "leaseToken": job["leaseToken"],
            "status": status,
            "error": error[:500],
        })
        TelegramAppUploader._json(response)

    def report_progress(self, job: dict, uploaded_bytes: int, total_bytes: int) -> None:
        response = self._post("progress", {
            "jobId": job["jobId"],
            "leaseToken": job["leaseToken"],
            "uploadedBytes": int(uploaded_bytes),
            "totalBytes": int(total_bytes),
        })
        TelegramAppUploader._json(response)

    def _report_progress_safely(self, job: dict, uploaded_bytes: int, total_bytes: int) -> None:
        try:
            self.report_progress(job, uploaded_bytes, total_bytes)
        except Exception:
            logging.warning("Không thể báo tiến độ job về ứng dụng", exc_info=True)

    def run_once(self) -> bool:
        from path_guard import resolve_user_path

        job = self.claim()
        if not job:
            return False
        try:
            path = resolve_user_path(job["path"], self._file_root)
            self._uploader.upload(
                path,
                job["code"],
                on_progress=lambda uploaded, total: self._report_progress_safely(job, uploaded, total),
            )
            self.finish(job, "completed")
        except Exception as exc:
            logging.exception("Tải job từ ứng dụng thất bại")
            try:
                self.finish(job, "failed", str(exc) or exc.__class__.__name__)
            except Exception:
                logging.exception("Không thể báo trạng thái job về ứng dụng")
        return True

    def run_forever(self) -> None:
        while True:
            try:
                processed = self.run_once()
            except Exception:
                logging.exception("Không thể nhận job từ ứng dụng")
                processed = False
            if not processed:
                time.sleep(self._poll_interval)
