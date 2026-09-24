from pathlib import Path

from telegram_api import TelegramApi


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, payload=None):
        self.payload = payload or {"ok": True, "result": []}
        self.calls = []

    def get(self, url, **kwargs):
        self.calls.append(("GET", url, kwargs))
        return FakeResponse(self.payload)

    def post(self, url, **kwargs):
        file_info = None
        if kwargs.get("files"):
            upload = kwargs["files"]["document"]
            file_info = (upload.name, upload.mode, upload.closed)
        self.calls.append(("POST", url, kwargs | {"file_info": file_info}))
        return FakeResponse(self.payload)


def test_get_updates_uses_local_endpoint_and_long_poll_timeout():
    session = FakeSession({"ok": True, "result": [{"update_id": 7}]})
    api = TelegramApi("http://127.0.0.1:8081", "secret-token", session)

    result = api.get_updates(offset=6, timeout=30)

    assert result == [{"update_id": 7}]
    assert session.calls == [
        (
            "GET",
            "http://127.0.0.1:8081/botsecret-token/getUpdates",
            {"params": {"offset": 6, "timeout": 30}, "timeout": 40},
        )
    ]


def test_send_message_posts_chat_and_text():
    session = FakeSession({"ok": True, "result": {"message_id": 1}})
    api = TelegramApi("http://127.0.0.1:8081/", "secret-token", session)

    api.send_message(123, "Xin chào")

    method, url, kwargs = session.calls[0]
    assert method == "POST"
    assert url == "http://127.0.0.1:8081/botsecret-token/sendMessage"
    assert kwargs == {"data": {"chat_id": 123, "text": "Xin chào"}, "timeout": 30, "file_info": None}


def test_send_message_serializes_inline_keyboard():
    session = FakeSession({"ok": True, "result": {"message_id": 1}})
    api = TelegramApi("http://127.0.0.1:8081", "secret-token", session)
    keyboard = {"inline_keyboard": [[{"text": "⬇ file", "callback_data": "browse:abc"}]]}

    api.send_message(123, "Chọn file", reply_markup=keyboard)

    assert session.calls[0][2]["data"]["reply_markup"] == '{"inline_keyboard": [[{"text": "⬇ file", "callback_data": "browse:abc"}]]}'


def test_send_document_streams_binary_file_and_closes_it(tmp_path: Path):
    source = tmp_path / "thiết kế.psd"
    source.write_bytes(b"photoshop")
    session = FakeSession({"ok": True, "result": {"message_id": 2}})
    api = TelegramApi("http://127.0.0.1:8081", "secret-token", session)

    caption = '<a href="tg://user?id=77">Anh Nam</a>, Bot gửi file nha'
    api.send_document(123, str(source), caption=caption, parse_mode="HTML")

    method, url, kwargs = session.calls[0]
    assert method == "POST"
    assert url == "http://127.0.0.1:8081/botsecret-token/sendDocument"
    assert kwargs["data"] == {"chat_id": 123, "caption": caption, "parse_mode": "HTML"}
    assert kwargs["timeout"] == (30, 7200)
    assert kwargs["file_info"] == (str(source), "rb", False)
    assert kwargs["files"]["document"].closed is True
