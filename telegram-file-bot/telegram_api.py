"""HTTP client nhỏ cho Telegram Bot API chạy tại máy công ty."""

from __future__ import annotations

import json
import requests


class TelegramApiError(RuntimeError):
    pass


class TelegramApi:
    def __init__(self, base_url: str, token: str, session=None):
        self._base = f"{base_url.rstrip('/')}/bot{token}"
        self._session = session or requests.Session()

    @staticmethod
    def _result(response):
        response.raise_for_status()
        payload = response.json()
        if not payload.get("ok"):
            raise TelegramApiError(payload.get("description", "Telegram API trả về lỗi."))
        return payload.get("result")

    def get_me(self) -> dict:
        response = self._session.get(f"{self._base}/getMe", timeout=30)
        return self._result(response)

    def get_updates(self, offset: int | None, timeout: int = 30) -> list[dict]:
        params = {"offset": offset, "timeout": timeout}
        response = self._session.get(
            f"{self._base}/getUpdates", params=params, timeout=timeout + 10
        )
        return self._result(response)

    def send_message(
        self,
        chat_id: int,
        text: str,
        reply_markup: dict | None = None,
        parse_mode: str | None = None,
    ) -> None:
        data = {"chat_id": chat_id, "text": text}
        if reply_markup is not None:
            data["reply_markup"] = json.dumps(reply_markup, ensure_ascii=False)
        if parse_mode is not None:
            data["parse_mode"] = parse_mode
        response = self._session.post(
            f"{self._base}/sendMessage",
            data=data,
            timeout=30,
        )
        self._result(response)

    def answer_callback_query(self, callback_id: str, text: str = "") -> None:
        response = self._session.post(
            f"{self._base}/answerCallbackQuery",
            data={"callback_query_id": callback_id, "text": text},
            timeout=30,
        )
        self._result(response)

    def send_document(self, chat_id: int, path: str, caption: str | None = None, parse_mode: str | None = None) -> None:
        data = {"chat_id": chat_id}
        if caption is not None:
            data["caption"] = caption
        if parse_mode is not None:
            data["parse_mode"] = parse_mode
        with open(path, "rb") as document:
            response = self._session.post(
                f"{self._base}/sendDocument",
                data=data,
                files={"document": document},
                timeout=(30, 7200),
            )
            self._result(response)
