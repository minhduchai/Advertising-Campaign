import threading
from pathlib import Path

import pytest

from bot import BrowserStore, Config, SearchProgress, TransferQueue, handle_update, parse_command
from telegram_app_upload import TelegramUploadIntentStore


class FakeApi:
    def __init__(self):
        self.messages = []
        self.documents = []
        self.captions = []
        self.keyboards = []
        self.callback_answers = []

    def send_message(self, chat_id, text, reply_markup=None, parse_mode=None):
        self.messages.append((chat_id, text))
        self.keyboards.append(reply_markup)
        return {"message_id": len(self.messages)}

    def edit_message_text(self, chat_id, message_id, text):
        self.messages.append((chat_id, text))
        self.keyboards.append(None)
        return {"message_id": message_id}

    def send_document(self, chat_id, path, caption=None, parse_mode=None):
        self.documents.append((chat_id, path))
        self.captions.append((caption, parse_mode))

    def get_me(self):
        return {"username": "company_file_bot"}

    def answer_callback_query(self, callback_id, text=""):
        self.callback_answers.append((callback_id, text))


def make_update(user_id=123, text="/start", chat_type="private", chat_id=999, username="dominic", first_name="Dominic"):
    return {
        "update_id": 10,
        "message": {
            "chat": {"id": chat_id, "type": chat_type},
            "from": {"id": user_id, "username": username, "first_name": first_name},
            "text": text,
        },
    }


def make_callback(data, user_id=123, chat_type="private", chat_id=999):
    return {
        "update_id": 11,
        "callback_query": {
            "id": "callback-1",
            "from": {"id": user_id},
            "data": data,
            "message": {"chat": {"id": chat_id, "type": chat_type}},
        },
    }


def test_parse_command_preserves_spaces_and_unicode():
    assert parse_command("/get CHUNG\\THIET KE\\Danh\\THÁNG 8\\file.psd") == (
        "/get",
        "CHUNG\\THIET KE\\Danh\\THÁNG 8\\file.psd",
    )


def test_search_progress_updates_elapsed_time_and_finishes(monkeypatch):
    moments = iter([100.0, 107.0, 112.0])
    monkeypatch.setattr("bot.time.monotonic", lambda: next(moments))
    api = FakeApi()
    progress = SearchProgress(api, 999, autostart=False)

    progress.tick()
    progress.finish()

    assert [text for _, text in api.messages] == [
        "🔎 Bot đang tìm file… 0 giây",
        "🔎 Bot đang tìm file… 7 giây",
        "✅ Tìm xong sau 12 giây",
    ]


def test_unauthorized_user_is_denied(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    handle_update(make_update(user_id=456), api, config, threading.Lock())
    assert api.messages == [(999, "Bạn không được phép sử dụng bot này.")]


def test_group_not_in_allowlist_is_denied(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    handle_update(make_update(chat_type="group", chat_id=-1001), api, config, threading.Lock())
    assert api.messages == [(-1001, "Group này chưa được phép sử dụng bot.")]


def test_any_member_in_allowed_group_can_browse_by_pasting_path(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081", frozenset({-1001}))

    handle_update(
        make_update(user_id=456, text=str(tmp_path), chat_type="supergroup", chat_id=-1001),
        api,
        config,
        threading.Lock(),
    )

    assert "Thư mục:" in api.messages[0][1]


def test_allowed_group_can_paste_file_path_into_shared_queue(tmp_path: Path):
    source = tmp_path / "video trực tiếp.mp4"
    source.write_bytes(b"video")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081", frozenset({-1001}))
    transfer_queue = TransferQueue(api, autostart=False)

    handle_update(
        make_update(
            user_id=456,
            text=str(source),
            chat_type="group",
            chat_id=-1001,
            username="member",
        ),
        api,
        config,
        threading.Lock(),
        BrowserStore(),
        transfer_queue,
    )

    assert api.messages == []
    transfer_queue.process_next()
    assert api.documents == [(-1001, str(source))]
    assert api.messages == []
    assert api.captions == [("@member, Bot gửi file nha", "HTML")]


def test_allowed_group_ignores_normal_conversation(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081", frozenset({-1001}))

    handle_update(
        make_update(user_id=456, text="Mọi người họp lúc 3 giờ nhé", chat_type="group", chat_id=-1001),
        api,
        config,
        threading.Lock(),
    )

    assert api.messages == []


@pytest.mark.parametrize("command", ["/start", "/status", "/ls", "/get file.mp4", "/whoami"])
def test_group_member_commands_are_silently_ignored(tmp_path: Path, command: str):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081", frozenset({-1001}))

    handle_update(
        make_update(user_id=456, text=command, chat_type="group", chat_id=-1001),
        api,
        config,
        threading.Lock(),
    )

    assert api.messages == []


def test_group_owner_can_still_use_status(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081", frozenset({-1001}))

    handle_update(
        make_update(user_id=123, text="/status", chat_type="group", chat_id=-1001),
        api,
        config,
        threading.Lock(),
    )

    assert "Bot @company_file_bot: hoạt động" in api.messages[0][1]


def test_status_reports_telegram_app_upload_ready(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    transfer_queue = TransferQueue(
        api,
        app_uploader=object(),
        autostart=False,
    )

    handle_update(
        make_update(user_id=123, text="/status"),
        api,
        config,
        threading.Lock(),
        transfer_queue=transfer_queue,
    )

    assert "Tải qua Telegram vào ứng dụng: sẵn sàng" in api.messages[0][1]


def test_owner_whoami_reports_ids_even_before_group_is_approved(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")

    handle_update(
        make_update(user_id=123, text="/whoami", chat_type="supergroup", chat_id=-1001),
        api,
        config,
        threading.Lock(),
    )

    assert api.messages == [(-1001, "User ID: 123\nChat ID: -1001\nLoại chat: supergroup")]


def test_allowed_group_member_can_click_file_button(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081", frozenset({-1001}))
    store = BrowserStore()
    token = store.add("download", str(source), 0)

    handle_update(
        make_callback(f"browse:{token}", user_id=456, chat_type="supergroup", chat_id=-1001),
        api,
        config,
        threading.Lock(),
        store,
    )

    assert api.documents == [(-1001, str(source))]


def test_member_of_unapproved_group_cannot_click_button(tmp_path: Path):
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    store = BrowserStore()
    token = store.add("list", str(tmp_path), 0)

    handle_update(
        make_callback(f"browse:{token}", user_id=456, chat_type="group", chat_id=-1002),
        api,
        config,
        threading.Lock(),
        store,
    )

    assert api.callback_answers == [("callback-1", "Group này chưa được phép sử dụng bot.")]


def test_ls_lists_directory(tmp_path: Path):
    (tmp_path / "Thiết kế").mkdir()
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    handle_update(make_update(text="/ls"), api, config, threading.Lock())
    assert "[THƯ MỤC] Thiết kế" in api.messages[0][1]


def test_get_sends_valid_file(tmp_path: Path):
    source = tmp_path / "banner.png"
    source.write_bytes(b"png")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    handle_update(make_update(text="/get banner.png"), api, config, threading.Lock())
    assert api.documents == [(999, str(source))]
    assert api.messages == []
    assert api.captions == [("@dominic, Bot gửi file nha", "HTML")]


def test_find_suggests_similar_file_with_download_button(tmp_path: Path):
    source = tmp_path / "VIDEO_1109_TUYETVAN_CFURANHCUOI5000K.mp4"
    source.write_bytes(b"video")
    api = FakeApi()
    store = BrowserStore()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")

    handle_update(
        make_update(text="/find video 1109 tuyet van cfu ranh cuoi 5000k.mp4"),
        api,
        config,
        threading.Lock(),
        store,
    )

    assert "Bot đang tìm file" in api.messages[0][1]
    assert "Tìm xong" in api.messages[1][1]
    assert source.name in api.messages[2][1]
    assert api.keyboards[2]["inline_keyboard"][0][0]["callback_data"].startswith("browse:")


def test_missing_pasted_path_falls_back_to_similar_search(tmp_path: Path):
    source = tmp_path / "quang-cao-jovena.mp4"
    source.write_bytes(b"video")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")

    handle_update(
        make_update(text=str(tmp_path / "quang cao jovenaa.mp4")),
        api,
        config,
        threading.Lock(),
        BrowserStore(),
    )

    assert "Bot đang tìm file" in api.messages[0][1]
    assert "Tìm xong" in api.messages[1][1]
    assert source.name in api.messages[2][1]


def test_missing_pasted_path_preserves_folder_spaces_and_prioritizes_near_match(tmp_path):
    folder = tmp_path / "VIDEO FINAL" / "TRIET LONG"
    folder.mkdir(parents=True)
    source = folder / "VIDEO_0910_NGAN_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI990KNANNHAN_T10+T11.mp4"
    source.write_bytes(b"video")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081", gemini_api_key="unused")
    handle_update(make_update(text=str(source).replace("990K", "99K")), api, config, threading.Lock(), BrowserStore())
    assert source.name in api.messages[-1][1]
    assert "⭐ Ưu tiên" in api.messages[-1][1]
    assert api.keyboards[-1]["inline_keyboard"][0][0]["text"].startswith("⭐")


def test_pasting_full_file_path_sends_file(tmp_path: Path):
    source = tmp_path / "banner trực tiếp.png"
    source.write_bytes(b"png")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")

    handle_update(make_update(text=str(source)), api, config, threading.Lock())

    assert api.documents == [(999, str(source))]
    assert api.messages == []
    assert api.captions == [("@dominic, Bot gửi file nha", "HTML")]


def test_pasting_full_directory_path_lists_contents(tmp_path: Path):
    (tmp_path / "Thiết kế trực tiếp").mkdir()
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")

    handle_update(make_update(text=str(tmp_path)), api, config, threading.Lock())

    assert "[THƯ MỤC] Thiết kế trực tiếp" in api.messages[0][1]


def test_directory_listing_adds_short_file_and_folder_buttons(tmp_path: Path):
    (tmp_path / "Thư mục con").mkdir()
    (tmp_path / "ảnh.jpg").write_bytes(b"jpg")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    store = BrowserStore()

    handle_update(make_update(text=str(tmp_path)), api, config, threading.Lock(), store)

    buttons = [button for row in api.keyboards[0]["inline_keyboard"] for button in row]
    assert [button["text"] for button in buttons[:2]] == ["📁 Thư mục con", "⬇ ảnh.jpg"]
    assert all(len(button["callback_data"].encode("utf-8")) <= 64 for button in buttons)
    assert all(str(tmp_path) not in button["callback_data"] for button in buttons)


def test_clicking_file_button_sends_file(tmp_path: Path):
    source = tmp_path / "ảnh.jpg"
    source.write_bytes(b"jpg")
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    store = BrowserStore()
    handle_update(make_update(text=str(tmp_path)), api, config, threading.Lock(), store)
    callback_data = api.keyboards[0]["inline_keyboard"][0][0]["callback_data"]

    handle_update(make_callback(callback_data), api, config, threading.Lock(), store)

    assert api.documents == [(999, str(source))]
    assert api.callback_answers[-1] == ("callback-1", "")


def test_expired_button_reports_expiration(tmp_path: Path):
    now = [100.0]
    store = BrowserStore(ttl_seconds=60, clock=lambda: now[0])
    token = store.add("list", str(tmp_path), 0)
    now[0] = 161.0
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")

    handle_update(make_callback(f"browse:{token}"), api, config, threading.Lock(), store)

    assert api.callback_answers == [("callback-1", "Nút đã hết hạn. Anh dán lại đường dẫn nhé.")]


def test_get_rejects_when_another_transfer_is_busy(tmp_path: Path):
    source = tmp_path / "banner.png"
    source.write_bytes(b"png")
    lock = threading.Lock()
    lock.acquire()
    api = FakeApi()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")
    handle_update(make_update(text="/get banner.png"), api, config, lock)
    assert api.messages == [(999, "Bot đang gửi một file khác, anh thử lại sau nhé.")]


def test_transfer_queue_sends_fifo_and_tags_each_requester(tmp_path: Path):
    first = tmp_path / "video-1.mp4"
    second = tmp_path / "video-2.mp4"
    first.write_bytes(b"one")
    second.write_bytes(b"two")
    api = FakeApi()
    queue = TransferQueue(api, autostart=False)

    assert queue.enqueue(10, {"id": 1, "username": "alice"}, str(first)) == 1
    assert queue.enqueue(20, {"id": 2, "username": "bob"}, str(second)) == 2
    queue.process_next()
    queue.process_next()

    assert api.documents == [(10, str(first)), (20, str(second))]
    assert api.messages == []
    assert api.captions == [("@alice, Bot gửi file nha", "HTML"), ("@bob, Bot gửi file nha", "HTML")]


def test_transfer_queue_mentions_user_without_username(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")
    api = FakeApi()
    queue = TransferQueue(api, autostart=False)
    queue.enqueue(10, {"id": 77, "first_name": "Anh Nam & <Bạn>"}, str(source))

    queue.process_next()

    assert api.messages == []
    assert api.captions == [('<a href="tg://user?id=77">Anh Nam &amp; &lt;Bạn&gt;</a>, Bot gửi file nha', "HTML")]


def test_transfer_queue_rejects_duplicate_for_same_user(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")
    api = FakeApi()
    queue = TransferQueue(api, autostart=False)

    assert queue.enqueue(10, {"id": 1, "username": "alice"}, str(source)) == 1
    assert queue.enqueue(10, {"id": 1, "username": "alice"}, str(source)) is None


def test_transfer_queue_continues_after_failed_upload(tmp_path: Path):
    first = tmp_path / "bad.mp4"
    second = tmp_path / "good.mp4"
    first.write_bytes(b"bad")
    second.write_bytes(b"good")

    class FailingOnceApi(FakeApi):
        def send_document(self, chat_id, path, **kwargs):
            if path == str(first):
                raise RuntimeError("upload failed")
            super().send_document(chat_id, path, **kwargs)

    api = FailingOnceApi()
    queue = TransferQueue(api, autostart=False)
    queue.enqueue(10, {"id": 1, "username": "alice"}, str(first))
    queue.enqueue(20, {"id": 2, "username": "bob"}, str(second))

    queue.process_next()
    queue.process_next()

    assert api.documents == [(20, str(second))]
    assert any("xử lý file thất bại" in text for _, text in api.messages)


def test_transfer_queue_uploads_to_app_and_tags_requester(tmp_path: Path):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")

    class FakeAppUploader:
        def __init__(self):
            self.requests = []

        def upload(self, path, code):
            self.requests.append((path, code))
            return {"status": "completed", "mediaId": "media-123"}

    api = FakeApi()
    app_uploader = FakeAppUploader()
    queue = TransferQueue(
        api,
        app_uploader=app_uploader,
        app_url="https://setads.click",
        autostart=False,
    )
    queue.enqueue(10, {"id": 1, "username": "alice"}, str(source), "app", "intent-1")

    queue.process_next()

    assert app_uploader.requests == [(str(source), "intent-1")]
    assert api.documents == []
    assert "@alice, bot đang tải video.mp4" in api.messages[0][1]
    assert "media-123" in api.messages[1][1]
    assert "Quay lại ứng dụng" in api.messages[1][1]


def test_app_deep_link_changes_only_the_next_file_to_app_upload(tmp_path: Path):
    source = tmp_path / "video-app.mp4"
    source.write_bytes(b"video")

    class FakeAppUploader:
        def __init__(self):
            self.requests = []

        def upload(self, path, code):
            self.requests.append((path, code))
            return {"status": "completed", "mediaId": "media-456"}

    api = FakeApi()
    app_uploader = FakeAppUploader()
    queue = TransferQueue(api, app_uploader=app_uploader, autostart=False)
    intents = TelegramUploadIntentStore()
    config = Config("token", 123, str(tmp_path), "http://127.0.0.1:8081")

    handle_update(
        make_update(user_id=123, text="/start app_intent-code"),
        api,
        config,
        threading.Lock(),
        BrowserStore(),
        queue,
        intents,
    )
    handle_update(
        make_update(user_id=123, text=str(source)),
        api,
        config,
        threading.Lock(),
        BrowserStore(),
        queue,
        intents,
    )
    queue.process_next()

    assert app_uploader.requests == [(str(source), "intent-code")]
    assert api.documents == []
    assert not intents.has(123)
