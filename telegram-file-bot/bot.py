"""Bot Telegram riêng tư để gửi file từ ổ mạng công ty."""

from __future__ import annotations

import logging
import html
import ntpath
import os
import queue
import secrets
import threading
import time
from dataclasses import dataclass

from file_search import find_file_matches, normalize_shared_path

from path_guard import (
    FileTooLarge,
    InvalidTargetType,
    PathOutsideRoot,
    list_directory,
    resolve_existing_unicode_path,
    validate_download,
)
from telegram_api import TelegramApi
from telegram_app_upload import TelegramAppUploader, TelegramPathJobWorker, TelegramUploadIntentStore


MAX_FILE_BYTES = 2_000_000_000
HELP = (
    "Các lệnh:\n"
    "/whoami - xem User ID và Chat ID\n"
    "/status - kiểm tra bot và ổ mạng\n"
    "/ls [đường dẫn] - liệt kê thư mục\n"
    "/get <đường dẫn file> - gửi file\n"
    "/find <tên hoặc link file> - tìm file gần đúng\n"
    "Hoặc dán trực tiếp đường dẫn file/thư mục từ ổ marketing."
)


@dataclass(frozen=True)
class Config:
    bot_token: str
    allowed_user_id: int
    file_root: str
    bot_api_base: str
    allowed_group_ids: frozenset[int] = frozenset()
    app_url: str = "https://setads.click"
    telegram_upload_worker_secret: str = ""
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.8-flash"


@dataclass(frozen=True)
class BrowserAction:
    kind: str
    path: str
    page: int


class BrowserStore:
    def __init__(self, ttl_seconds: int = 3600, clock=time.monotonic):
        self.ttl_seconds = ttl_seconds
        self.clock = clock
        self._items: dict[str, tuple[float, BrowserAction]] = {}
        self._lock = threading.Lock()

    def add(self, kind: str, path: str, page: int = 0) -> str:
        token = secrets.token_urlsafe(6)
        with self._lock:
            self._items[token] = (self.clock() + self.ttl_seconds, BrowserAction(kind, path, page))
        return token

    def resolve(self, token: str) -> BrowserAction | None:
        now = self.clock()
        with self._lock:
            expired = [key for key, (deadline, _) in self._items.items() if deadline < now]
            for key in expired:
                self._items.pop(key, None)
            item = self._items.get(token)
        return item[1] if item else None


class SearchProgress:
    def __init__(self, api, chat_id: int, interval: int = 1, autostart: bool = True):
        self.api = api
        self.chat_id = chat_id
        self.interval = interval
        self.started = time.monotonic()
        self.stopped = threading.Event()
        self._edit_lock = threading.Lock()
        result = api.send_message(chat_id, "🔎 Bot đang tìm file… 0 giây")
        self.message_id = int((result or {}).get("message_id", 0))
        if autostart and self.message_id:
            threading.Thread(target=self._run, daemon=True, name="search-progress").start()

    def tick(self) -> None:
        with self._edit_lock:
            if not self.stopped.is_set():
                elapsed = max(0, int(time.monotonic() - self.started))
                self.api.edit_message_text(self.chat_id, self.message_id, f"🔎 Bot đang tìm file… {elapsed} giây")

    def _run(self) -> None:
        while not self.stopped.wait(self.interval):
            try:
                self.tick()
            except Exception:
                logging.exception("Không cập nhật được thời gian tìm file")

    def finish(self, success: bool = True) -> None:
        self.stopped.set()
        if self.message_id:
            with self._edit_lock:
                elapsed = max(0, int(time.monotonic() - self.started))
                status = "✅ Tìm xong" if success else "⚠️ Dừng tìm"
                try:
                    self.api.edit_message_text(self.chat_id, self.message_id, f"{status} sau {elapsed} giây")
                except Exception:
                    logging.exception("Không cập nhật được trạng thái tìm file")


@dataclass(frozen=True)
class TransferRequest:
    chat_id: int
    requester_id: int
    requester_name: str
    requester_username: str
    path: str
    destination: str
    intent_code: str = ""


class TransferQueue:
    def __init__(
        self,
        api,
        app_uploader=None,
        app_url: str = "",
        autostart: bool = True,
    ):
        self.api = api
        self.app_uploader = app_uploader
        self.app_url = app_url.rstrip("/")
        self._queue: queue.Queue[TransferRequest] = queue.Queue()
        self._pending: set[tuple[int, str, str]] = set()
        self._lock = threading.Lock()
        if autostart:
            threading.Thread(target=self._worker, daemon=True, name="transfer-worker").start()

    def enqueue(
        self,
        chat_id: int,
        requester: dict,
        path: str,
        destination: str = "telegram",
        intent_code: str = "",
    ) -> int | None:
        validate_download(path, MAX_FILE_BYTES)
        if destination not in {"telegram", "app"}:
            raise ValueError("Nơi nhận file không hợp lệ")
        requester_id = int(requester.get("id", 0))
        key = (requester_id, ntpath.normcase(ntpath.normpath(path)), destination)
        with self._lock:
            if key in self._pending:
                return None
            self._pending.add(key)
            position = self._queue.qsize() + 1
            self._queue.put(
                TransferRequest(
                    chat_id,
                    requester_id,
                    str(requester.get("first_name") or "Thành viên"),
                    str(requester.get("username") or ""),
                    path,
                    destination,
                    intent_code,
                )
            )
        return position

    @staticmethod
    def _mention(request: TransferRequest) -> str:
        if request.requester_username:
            return "@" + html.escape(request.requester_username)
        name = html.escape(request.requester_name)
        return f'<a href="tg://user?id={request.requester_id}">{name}</a>'

    def process_next(self) -> bool:
        try:
            request = self._queue.get_nowait()
        except queue.Empty:
            return False
        self._process_request(request)
        return True

    def _process_request(self, request: TransferRequest) -> None:
        key = (
            request.requester_id,
            ntpath.normcase(ntpath.normpath(request.path)),
            request.destination,
        )
        mention = self._mention(request)
        try:
            size = validate_download(request.path, MAX_FILE_BYTES)
            filename = html.escape(os.path.basename(request.path))
            if request.destination == "app":
                if not self.app_uploader or not request.intent_code:
                    raise RuntimeError("Thiếu phiên tải file từ ứng dụng")
                self.api.send_message(
                    request.chat_id,
                    f"{mention}, bot đang tải {filename} ({size / 1_000_000:.1f} MB) lên ứng dụng...",
                    parse_mode="HTML",
                )
                result = self.app_uploader.upload(request.path, request.intent_code)
                media_id = html.escape(str(result.get("mediaId") or ""))
                detail = f"\nMã media: <code>{media_id}</code>" if media_id else ""
                app_link = f'\n<a href="{html.escape(self.app_url)}">Quay lại ứng dụng</a>' if self.app_url else ""
                self.api.send_message(
                    request.chat_id,
                    f"{mention}, file đã được tải lên ứng dụng thành công.{detail}{app_link}",
                    parse_mode="HTML",
                )
            else:
                self.api.send_document(
                    request.chat_id,
                    request.path,
                    caption=f"{mention}, Bot gửi file nha",
                    parse_mode="HTML",
                )
        except Exception:
            logging.exception("Xử lý file trong hàng đợi thất bại")
            self.api.send_message(
                request.chat_id,
                f"{mention}, xử lý file thất bại. Bot sẽ tiếp tục file kế tiếp.",
                parse_mode="HTML",
            )
        finally:
            with self._lock:
                self._pending.discard(key)
            self._queue.task_done()

    def _worker(self) -> None:
        while True:
            request = self._queue.get()
            self._process_request(request)


def enqueue_file(
    chat_id: int,
    sender: dict,
    target: str,
    api,
    transfer_queue: TransferQueue,
    destination: str = "telegram",
    intent_code: str = "",
) -> None:
    position = transfer_queue.enqueue(chat_id, sender, target, destination, intent_code)
    if position is None:
        api.send_message(chat_id, "File này đã có trong hàng đợi của bạn.")
    else:
        if destination == "app":
            api.send_message(chat_id, f"Đã thêm tải lên ứng dụng vào hàng đợi. Vị trí: {position}")


def parse_command(text: str) -> tuple[str, str]:
    command, separator, argument = (text or "").strip().partition(" ")
    command = command.split("@", 1)[0].lower()
    return command, argument.strip() if separator else ""


def format_listing(target: str, entries: list[str], truncated: bool) -> str:
    body = "\n".join(entries) if entries else "(Thư mục trống)"
    suffix = "\n\nDanh sách đã rút gọn; hãy nhập đường dẫn cụ thể hơn." if truncated else ""
    return f"Thư mục: {target}\n\n{body}{suffix}"


def send_file(chat_id: int, target: str, api, transfer_lock: threading.Lock, requester: dict | None = None) -> None:
    if not transfer_lock.acquire(blocking=False):
        api.send_message(chat_id, "Bot đang gửi một file khác, anh thử lại sau nhé.")
        return
    try:
        validate_download(target, MAX_FILE_BYTES)
        requester = requester or {}
        request = TransferRequest(chat_id, int(requester.get("id", 0)), str(requester.get("first_name") or "Thành viên"), str(requester.get("username") or ""), target, "telegram")
        mention = TransferQueue._mention(request)
        api.send_document(chat_id, target, caption=f"{mention}, Bot gửi file nha", parse_mode="HTML")
    finally:
        transfer_lock.release()


def render_directory(chat_id: int, target: str, api, config: Config, store: BrowserStore, page: int = 0) -> None:
    if not os.path.isdir(target):
        raise InvalidTargetType("Đường dẫn không phải thư mục.")
    with os.scandir(target) as iterator:
        items = list(iterator)
    items.sort(key=lambda item: (not item.is_dir(), item.name.casefold()))
    page_size = 10
    max_page = max(0, (len(items) - 1) // page_size)
    page = min(max(page, 0), max_page)
    visible = items[page * page_size : (page + 1) * page_size]
    lines, keyboard = [], []
    for item in visible:
        if item.is_dir():
            lines.append(f"[THƯ MỤC] {item.name}")
            kind, label = "list", f"📁 {item.name}"
        else:
            size_mb = item.stat().st_size / (1024 * 1024)
            lines.append(f"[FILE] {item.name} ({size_mb:.1f} MB)")
            kind, label = "download", f"⬇ {item.name}"
        token = store.add(kind, item.path, 0)
        keyboard.append([{"text": label[:60], "callback_data": f"browse:{token}"}])

    navigation = []
    if page > 0:
        token = store.add("list", target, page - 1)
        navigation.append({"text": "◀ Trang trước", "callback_data": f"browse:{token}"})
    if page < max_page:
        token = store.add("list", target, page + 1)
        navigation.append({"text": "Trang sau ▶", "callback_data": f"browse:{token}"})
    if navigation:
        keyboard.append(navigation)
    if ntpath.normcase(ntpath.normpath(target)) != ntpath.normcase(ntpath.normpath(config.file_root)):
        token = store.add("list", ntpath.dirname(target), 0)
        keyboard.append([{"text": "⬅ Quay lại", "callback_data": f"browse:{token}"}])

    text = format_listing(target, lines, page < max_page)
    api.send_message(chat_id, text, {"inline_keyboard": keyboard})


def suggest_files(chat_id: int, raw: str, api, config: Config, store: BrowserStore | None) -> None:
    progress = SearchProgress(api, chat_id)
    success = False
    try:
        matches = find_file_matches(config.file_root, raw)
        success = True
    except (TimeoutError, OSError) as exc:
        api.send_message(chat_id, str(exc) if isinstance(exc, TimeoutError) else "Không đọc được thư mục mạng. Anh kiểm tra kết nối và quyền truy cập nhé.")
        return
    finally:
        progress.finish(success)
    if not matches:
        api.send_message(chat_id, "Không có file đạt mức tương đồng 55% trong phạm vi thư mục này. Anh kiểm tra lại thư mục hoặc tên file nhé.")
        return
    keyboard = []
    lines = ["Không thấy đúng đường dẫn. Bot tìm được các file gần giống:"]
    for match in matches:
        path = match.path
        priority = "⭐ Ưu tiên · " if match.is_exact_alternative else ""
        lines.append(f"• {priority}{ntpath.basename(path)} ({match.score:.0%})")
        if store:
            token = store.add("download", path)
            keyboard.append([{"text": f"{'⭐' if match.is_exact_alternative else '⬇'} {ntpath.basename(path)}"[:60], "callback_data": f"browse:{token}"}])
    api.send_message(chat_id, "\n".join(lines), {"inline_keyboard": keyboard} if keyboard else None)


def handle_update(
    update: dict,
    api,
    config: Config,
    transfer_lock: threading.Lock,
    browser_store: BrowserStore | None = None,
    transfer_queue: TransferQueue | None = None,
    telegram_intents: TelegramUploadIntentStore | None = None,
) -> None:
    callback = update.get("callback_query") or {}
    if callback:
        callback_id = callback.get("id", "")
        sender_id = int((callback.get("from") or {}).get("id", 0))
        chat = (callback.get("message") or {}).get("chat") or {}
        chat_id = int(chat.get("id", 0))
        chat_type = chat.get("type")
        if chat_type == "private" and sender_id != config.allowed_user_id:
            api.answer_callback_query(callback_id, "Bạn không được phép sử dụng nút này.")
            return
        if chat_type in {"group", "supergroup"} and chat_id not in config.allowed_group_ids:
            api.answer_callback_query(callback_id, "Group này chưa được phép sử dụng bot.")
            return
        if chat_type not in {"private", "group", "supergroup"}:
            api.answer_callback_query(callback_id, "Chat này không được phép sử dụng bot.")
            return
        token = str(callback.get("data", "")).removeprefix("browse:")
        action = browser_store.resolve(token) if browser_store else None
        if action is None:
            api.answer_callback_query(callback_id, "Nút đã hết hạn. Anh dán lại đường dẫn nhé.")
            return
        api.answer_callback_query(callback_id)
        try:
            target = resolve_existing_unicode_path(action.path, config.file_root)
            if action.kind == "list":
                render_directory(int(chat["id"]), target, api, config, browser_store, action.page)
            elif action.kind == "download":
                if transfer_queue:
                    intent_code = telegram_intents.pop(sender_id) if telegram_intents else None
                    enqueue_file(
                        int(chat["id"]),
                        callback.get("from") or {},
                        target,
                        api,
                        transfer_queue,
                        "app" if intent_code else "telegram",
                        intent_code or "",
                    )
                else:
                    send_file(int(chat["id"]), target, api, transfer_lock, callback.get("from"))
        except Exception:
            logging.exception("Xử lý nút thất bại")
            api.send_message(int(chat["id"]), "Không thể xử lý nút này. Anh dán lại đường dẫn nhé.")
        return

    message = update.get("message") or {}
    chat = message.get("chat") or {}
    sender = message.get("from") or {}
    text = message.get("text")
    if not text or "id" not in chat:
        return
    chat_id = int(chat["id"])
    chat_type = chat.get("type")
    sender_id = int(sender.get("id", 0))

    command, argument = parse_command(text)
    if (
        chat_type in {"group", "supergroup"}
        and command.startswith("/")
        and sender_id != config.allowed_user_id
    ):
        return
    if command == "/whoami":
        api.send_message(
            chat_id,
            f"User ID: {sender_id}\nChat ID: {chat_id}\nLoại chat: {chat_type}",
        )
        return

    if chat_type == "private" and sender_id != config.allowed_user_id:
        api.send_message(chat_id, "Bạn không được phép sử dụng bot này.")
        return
    if chat_type in {"group", "supergroup"} and chat_id not in config.allowed_group_ids:
        api.send_message(chat_id, "Group này chưa được phép sử dụng bot.")
        return
    if chat_type not in {"private", "group", "supergroup"}:
        api.send_message(chat_id, "Chat này không được phép sử dụng bot.")
        return

    try:
        if command == "/start" and argument.startswith("app_"):
            code = argument.removeprefix("app_")
            if not telegram_intents or not transfer_queue or not transfer_queue.app_uploader:
                api.send_message(chat_id, "Chức năng tải lên ứng dụng chưa sẵn sàng.")
                return
            telegram_intents.set(sender_id, code)
            api.send_message(
                chat_id,
                "Đã kết nối yêu cầu từ ứng dụng. Anh dán đường dẫn đầy đủ của một file ảnh hoặc video; file này sẽ chỉ được đưa lên ứng dụng.",
            )
        elif command == "/start":
            api.send_message(chat_id, HELP)
        elif command == "/status":
            username = api.get_me().get("username", "không rõ")
            network = "hoạt động" if os.path.isdir(config.file_root) else "mất kết nối"
            lines = [f"Bot @{username}: hoạt động", f"Ổ mạng: {network}"]
            if transfer_queue and transfer_queue.app_uploader:
                lines.append("Tải qua Telegram vào ứng dụng: sẵn sàng")
            if config.telegram_upload_worker_secret:
                lines.append("Nhận đường dẫn trực tiếp từ app: sẵn sàng")
            api.send_message(chat_id, "\n".join(lines))
        elif command == "/ls":
            target = resolve_existing_unicode_path(argument, config.file_root)
            if browser_store:
                render_directory(chat_id, target, api, config, browser_store)
            else:
                entries, truncated = list_directory(target)
                api.send_message(chat_id, format_listing(target, entries, truncated))
        elif command in {"/get", "/find"}:
            if not argument:
                api.send_message(chat_id, f"Cách dùng: {command} <đường dẫn hoặc tên file>")
                return
            if command == "/find":
                suggest_files(chat_id, argument, api, config, browser_store)
                return
            target = resolve_existing_unicode_path(argument, config.file_root)
            if transfer_queue:
                enqueue_file(chat_id, sender, target, api, transfer_queue, "telegram")
            else:
                send_file(chat_id, target, api, transfer_lock, sender)
        elif ntpath.isabs(normalize_shared_path(text)):
            target = resolve_existing_unicode_path(text, config.file_root)
            if os.path.isdir(target):
                if browser_store:
                    render_directory(chat_id, target, api, config, browser_store)
                else:
                    entries, truncated = list_directory(target)
                    api.send_message(chat_id, format_listing(target, entries, truncated))
            else:
                if transfer_queue:
                    intent_code = telegram_intents.pop(sender_id) if telegram_intents else None
                    enqueue_file(
                        chat_id,
                        sender,
                        target,
                        api,
                        transfer_queue,
                        "app" if intent_code else "telegram",
                        intent_code or "",
                    )
                else:
                    send_file(chat_id, target, api, transfer_lock, sender)
        else:
            if chat_type == "private" or command.startswith("/"):
                api.send_message(chat_id, HELP)
    except PathOutsideRoot as exc:
        api.send_message(chat_id, f"Từ chối đường dẫn: {exc}")
    except FileNotFoundError:
        suggest_files(chat_id, argument if command in {"/get", "/ls"} else text, api, config, browser_store)
    except (FileTooLarge, InvalidTargetType) as exc:
        api.send_message(chat_id, str(exc))
    except Exception:
        logging.exception("Xử lý lệnh thất bại")
        api.send_message(chat_id, "Có lỗi khi xử lý yêu cầu. Anh thử lại sau nhé.")


def load_config() -> Config:
    from dotenv import load_dotenv

    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'), encoding='utf-8-sig')
    required = ["BOT_TOKEN", "ALLOWED_USER_ID", "FILE_ROOT", "BOT_API_BASE"]
    missing = [name for name in required if not os.getenv(name)]
    if missing:
        raise RuntimeError("Thiếu cấu hình: " + ", ".join(missing))
    group_ids = frozenset(
        int(value.strip())
        for value in os.getenv("ALLOWED_GROUP_IDS", "").split(",")
        if value.strip()
    )
    return Config(
        os.environ["BOT_TOKEN"],
        int(os.environ["ALLOWED_USER_ID"]),
        os.environ["FILE_ROOT"],
        os.environ["BOT_API_BASE"],
        group_ids,
        os.getenv("APP_URL", "https://setads.click"),
        os.getenv("TELEGRAM_UPLOAD_WORKER_SECRET", ""),
        os.getenv("GEMINI_API_KEY", ""),
        os.getenv("GEMINI_MODEL", "gemini-3.8-flash"),
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    config = load_config()
    api = TelegramApi(config.bot_api_base, config.bot_token)
    transfer_lock = threading.Lock()
    browser_store = BrowserStore()
    telegram_intents = TelegramUploadIntentStore()
    transfer_queue = TransferQueue(
        api,
        app_uploader=TelegramAppUploader(config.app_url),
        app_url=config.app_url,
    )
    if config.telegram_upload_worker_secret:
        path_worker = TelegramPathJobWorker(
            config.app_url,
            config.telegram_upload_worker_secret,
            config.file_root,
            transfer_queue.app_uploader,
        )
        threading.Thread(
            target=path_worker.run_forever,
            daemon=True,
            name="telegram-path-worker",
        ).start()
        logging.info("Worker nhận đường dẫn từ ứng dụng đã khởi động")
    else:
        logging.warning("Thiếu TELEGRAM_UPLOAD_WORKER_SECRET; app chưa thể giao đường dẫn trực tiếp")
    offset = None
    logging.info("Bot đã khởi động")

    while True:
        try:
            for update in api.get_updates(offset, timeout=30):
                offset = int(update["update_id"]) + 1
                threading.Thread(
                    target=handle_update,
                    args=(
                        update,
                        api,
                        config,
                        transfer_lock,
                        browser_store,
                        transfer_queue,
                        telegram_intents,
                    ),
                    daemon=True,
                ).start()
        except KeyboardInterrupt:
            break
        except Exception:
            logging.exception("Polling thất bại; thử lại sau 3 giây")
            time.sleep(3)


if __name__ == "__main__":
    main()
