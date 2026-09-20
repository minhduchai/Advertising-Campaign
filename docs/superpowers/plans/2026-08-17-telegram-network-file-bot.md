# Kế hoạch triển khai bot Telegram gửi file từ ổ mạng

> **Dành cho tác nhân triển khai:** BẮT BUỘC dùng `subagent-driven-development` (khuyên dùng) hoặc `executing-plans` để thực hiện lần lượt từng đầu việc. Các bước dùng ô chọn `- [ ]` để theo dõi.

**Mục tiêu:** Tạo bot Telegram riêng tư trên máy Windows công ty, nhận đường dẫn tương đối hoặc UNC và gửi file từ `\\192.168.1.6\marketing` cho User ID `1643641244`.

**Kiến trúc:** Python 3.12 long-polling qua Local Bot API tại `127.0.0.1:8081`. Phần xử lý đường dẫn tách khỏi phần Telegram để kiểm thử mà không cần ổ mạng hoặc Internet. File được mở chỉ đọc và tải lên theo luồng bằng `requests`.

**Công nghệ:** Windows 10/11, Python 3.12, `requests`, `python-dotenv`, `pytest`, Docker Telegram Local Bot API.

## Ràng buộc chung

- Chỉ Telegram User ID `1643641244` được phép sử dụng.
- Chỉ được đọc bên trong `\\192.168.1.6\marketing`.
- Chấp nhận mọi loại file, tối đa `2_000_000_000` byte.
- Không có thao tác xóa, sửa, đổi tên, di chuyển hoặc ghi file.
- Chỉ một lượt gửi file được chạy tại một thời điểm.
- Bí mật chỉ nằm trong `C:\TelegramFileBot\.env` và không xuất hiện trong log.
- Mã nguồn và thông báo người dùng dùng tiếng Việt.

## Cấu trúc file

- `C:\TelegramFileBot\.env` — cấu hình và bí mật; đã có, chỉ bổ sung biến cần thiết.
- `C:\TelegramFileBot\requirements.txt` — phiên bản thư viện Python.
- `C:\TelegramFileBot\bot.py` — vòng polling, định tuyến lệnh và khởi động ứng dụng.
- `C:\TelegramFileBot\path_guard.py` — chuẩn hóa, kiểm tra phạm vi và đọc metadata file.
- `C:\TelegramFileBot\telegram_api.py` — lớp HTTP gọi Local Bot API và gửi file.
- `C:\TelegramFileBot\tests\test_path_guard.py` — kiểm thử bảo mật đường dẫn.
- `C:\TelegramFileBot\tests\test_bot.py` — kiểm thử phân quyền, câu lệnh và trạng thái bận.
- `C:\TelegramFileBot\tests\test_telegram_api.py` — kiểm thử cấu trúc request bằng HTTP giả.
- `C:\TelegramFileBot\run-bot.cmd` — lệnh chạy cố định dùng cho Task Scheduler.

---

### Đầu việc 1: Môi trường Python và cấu hình

**File:** tạo `requirements.txt`; sửa `.env` nhưng giữ nguyên ba biến Telegram Local API hiện có.

**Cung cấp:** môi trường ảo `C:\TelegramFileBot\.venv` và các biến `BOT_TOKEN`, `ALLOWED_USER_ID`, `FILE_ROOT`, `BOT_API_BASE`.

- [ ] **Bước 1: Bổ sung `.env` bằng Notepad, không hiển thị file trong terminal**

```text
BOT_TOKEN=<token mới đang hoạt động>
ALLOWED_USER_ID=1643641244
FILE_ROOT=\\192.168.1.6\marketing
BOT_API_BASE=http://127.0.0.1:8081
```

- [ ] **Bước 2: Tạo `requirements.txt`**

```text
python-dotenv==1.1.1
requests==2.32.5
pytest==8.4.1
```

- [ ] **Bước 3: Tạo môi trường và cài thư viện**

```powershell
Set-Location C:\TelegramFileBot
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

- [ ] **Bước 4: Kiểm tra thư viện**

```powershell
.\.venv\Scripts\python.exe -c "import requests, dotenv, pytest; print('OK')"
```

Kỳ vọng: in đúng `OK`, không có traceback.

### Đầu việc 2: Bảo vệ đường dẫn bằng TDD

**File:** tạo `path_guard.py`, `tests\test_path_guard.py`.

**Giao diện tạo ra:**

```python
class PathOutsideRoot(ValueError): ...
def resolve_user_path(raw_path: str, root: str) -> str: ...
def validate_download(path: str, max_bytes: int) -> int: ...
def list_directory(path: str, max_items: int = 80) -> tuple[list[str], bool]: ...
```

- [ ] **Bước 1: Viết test thất bại** cho đường dẫn tương đối, UNC đầy đủ, Unicode, `..`, share khác và tiền tố giả như `marketing-secret`.
- [ ] **Bước 2: Chạy test để xác nhận RED**

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_path_guard.py -v
```

Kỳ vọng: lỗi import `path_guard` hoặc thiếu các hàm trên.

- [ ] **Bước 3: Viết tối thiểu `path_guard.py`** bằng `ntpath.normpath`, từ chối chuỗi chứa thành phần `..`, từ chối tiền tố thiết bị `\\?\`/`\\.\`, rồi dùng `ntpath.commonpath([root, candidate])` và `ntpath.normcase` để bắt buộc kết quả bằng thư mục gốc.
- [ ] **Bước 4: Thêm test metadata**: thư mục không được tải, file không tồn tại bị báo, file đúng giới hạn được nhận, file lớn hơn `2_000_000_000` bị từ chối.
- [ ] **Bước 5: Chạy GREEN**

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_path_guard.py -v
```

Kỳ vọng: tất cả test PASS.

### Đầu việc 3: Lớp Local Telegram API bằng TDD

**File:** tạo `telegram_api.py`, `tests\test_telegram_api.py`.

**Giao diện tạo ra:**

```python
class TelegramApi:
    def __init__(self, base_url: str, token: str, session=None): ...
    def get_updates(self, offset: int | None, timeout: int = 30) -> list[dict]: ...
    def send_message(self, chat_id: int, text: str) -> None: ...
    def send_document(self, chat_id: int, path: str) -> None: ...
```

- [ ] **Bước 1: Viết test thất bại** với fake session, khẳng định URL luôn bắt đầu bằng `http://127.0.0.1:8081/bot`, `getUpdates` dùng timeout dài và `sendDocument` gửi multipart với file mở ở chế độ `rb`.
- [ ] **Bước 2: Chạy RED**

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_telegram_api.py -v
```

- [ ] **Bước 3: Viết lớp tối thiểu**, gọi `raise_for_status()`, kiểm tra trường JSON `ok`, đóng file bằng `with open(path, "rb")`, đặt timeout upload `(30, 7200)`.
- [ ] **Bước 4: Chạy GREEN** và xác nhận mọi test PASS.

### Đầu việc 4: Lệnh bot và phân quyền bằng TDD

**File:** tạo `bot.py`, `tests\test_bot.py`.

**Giao diện tạo ra:**

```python
def parse_command(text: str) -> tuple[str, str]: ...
def handle_update(update: dict, api, config, transfer_lock) -> None: ...
def format_listing(root: str, target: str, entries: list[str], truncated: bool) -> str: ...
```

- [ ] **Bước 1: Viết test thất bại** cho `/start`, `/status`, `/ls`, `/get`, lệnh không biết, đường dẫn có khoảng trắng và Unicode; thêm trường hợp dán trực tiếp đường dẫn file để tự gửi và đường dẫn thư mục để tự liệt kê.
- [ ] **Bước 2: Viết test phân quyền**: User ID khác bị từ chối, chat không phải `private` bị từ chối, User ID đúng được xử lý.
- [ ] **Bước 3: Chạy RED** và xác nhận thất bại vì chưa có hàm.
- [ ] **Bước 4: Viết xử lý tối thiểu**: đọc toàn bộ phần sau dấu cách đầu tiên; `/ls` dùng `resolve_user_path` và `list_directory`; `/get` kiểm tra file rồi gọi `send_document`; `/status` kiểm tra `os.path.isdir(FILE_ROOT)` và gọi `getMe` qua API.
- [ ] **Bước 5: Thêm khóa `threading.Lock` không chờ**; yêu cầu thứ hai nhận thông báo đang gửi file, khóa luôn được nhả trong `finally`.
- [ ] **Bước 6: Chạy GREEN**

```powershell
.\.venv\Scripts\python.exe -m pytest tests\test_bot.py -v
```

- [ ] **Bước 7: Mở rộng bằng TDD cho bàn phím inline**: kiểm thử và triển khai nút mở thư mục, tải file, quay lại, phân trang 10 mục, callback hết hạn sau 60 phút và từ chối User ID khác; callback chỉ chứa mã ngắn, không chứa đường dẫn thật.

### Đầu việc 5: Vòng polling và kiểm tra toàn bộ

**File:** hoàn thiện `bot.py`.

- [ ] **Bước 1: Thêm test offset polling**: sau update ID `123`, lượt gọi sau dùng offset `124`; lỗi mạng chờ 3 giây rồi tiếp tục; log không chứa token.
- [ ] **Bước 2: Chạy RED**.
- [ ] **Bước 3: Viết `main()`**: nạp `.env`, kiểm tra đủ bốn biến, tạo `TelegramApi`, gọi `get_updates` liên tục, cập nhật offset và bắt lỗi ở ranh giới vòng lặp.
- [ ] **Bước 4: Chạy toàn bộ test**

```powershell
.\.venv\Scripts\python.exe -m pytest -v
```

Kỳ vọng: toàn bộ PASS, không warning và không kết nối Telegram thật.

- [ ] **Bước 5: Kiểm tra cú pháp**

```powershell
.\.venv\Scripts\python.exe -m py_compile bot.py path_guard.py telegram_api.py
```

Kỳ vọng: thoát với mã 0 và không in lỗi.

### Đầu việc 6: Nghiệm thu thủ công

- [ ] **Bước 1: Chạy bot trong PowerShell**

```powershell
Set-Location C:\TelegramFileBot
.\.venv\Scripts\python.exe bot.py
```

- [ ] **Bước 2: Trên Telegram chạy `/status`**; kỳ vọng Local API và ổ mạng đều báo hoạt động.
- [ ] **Bước 3: Chạy lệnh liệt kê thực tế**

```text
/ls CHUNG\THIET KE\Danh\THÁNG 8\BANNER_1708_NGOC_DANH_TRIETBANGGIAXANH_T08+T09
```

- [ ] **Bước 4: Gửi file PNG 3,8 MB trước**, kiểm tra tên và dung lượng nhận được.
- [ ] **Bước 5: Gửi file PSD khoảng 251 MB**, chờ Telegram báo gửi thành công và mở được file nhận về.
- [ ] **Bước 6: Thử `/get ..\file.txt` và một UNC ngoài marketing**; kỳ vọng bot từ chối.
- [ ] **Bước 7: Dừng bot bằng `Ctrl+C` sau khi nghiệm thu.**

### Đầu việc 7: Tự khởi động cùng Windows

**File:** tạo `run-bot.cmd`.

- [ ] **Bước 1: Tạo file chạy**

```bat
@echo off
cd /d C:\TelegramFileBot
C:\TelegramFileBot\.venv\Scripts\python.exe C:\TelegramFileBot\bot.py >> C:\TelegramFileBot\bot.log 2>&1
```

- [ ] **Bước 2: Tạo Task Scheduler** tên `Telegram Company File Bot`, trigger `At startup`, trì hoãn 60 giây, chạy bằng đúng tài khoản Windows có quyền ổ mạng, chọn `Run whether user is logged on or not`, action là `C:\TelegramFileBot\run-bot.cmd`.
- [ ] **Bước 3: Khởi chạy task thủ công**, chờ 10 giây rồi gửi `/status`.
- [ ] **Bước 4: Khởi động lại Windows**, xác nhận Docker container `telegram-bot-api` ở trạng thái `Up` và bot trả lời `/status` mà không mở PowerShell.

## Điều kiện bàn giao

- Toàn bộ pytest PASS.
- File PNG và PSD 251 MB đều gửi thành công.
- User ID khác và đường dẫn ngoài thư mục gốc đều bị chặn.
- Bot tự hoạt động lại sau khi khởi động Windows.
- Không có bot token hoặc API hash trong ảnh chụp, log hay mã nguồn.
