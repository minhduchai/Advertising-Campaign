"""Bảo vệ mọi thao tác file trong thư mục mạng được cho phép."""

from __future__ import annotations

import ntpath
import os

from file_search import normalize_shared_path


class PathOutsideRoot(ValueError):
    """Đường dẫn nằm ngoài thư mục được phép."""


class FileTooLarge(ValueError):
    """File vượt giới hạn gửi của Local Bot API."""


class InvalidTargetType(ValueError):
    """Đường dẫn không trỏ tới đúng loại đối tượng."""


def resolve_user_path(raw_path: str, root: str) -> str:
    root_normalized = ntpath.normpath(root)
    raw = normalize_shared_path(raw_path)

    if root_normalized.startswith("\\\\") and raw.startswith("\\") and not raw.startswith("\\\\"):
        possible_unc = "\\" + raw
        root_case = ntpath.normcase(root_normalized)
        possible_case = ntpath.normcase(ntpath.normpath(possible_unc))
        if possible_case == root_case or possible_case.startswith(root_case + "\\"):
            raw = possible_unc

    if raw.startswith(("\\\\?\\", "\\\\.\\")):
        raise PathOutsideRoot("Đường dẫn thiết bị không được phép.")

    if any(part == ".." for part in raw.replace("/", "\\").split("\\")):
        raise PathOutsideRoot("Không được dùng '..' trong đường dẫn.")

    candidate = ntpath.normpath(raw if ntpath.isabs(raw) else ntpath.join(root_normalized, raw))
    root_case = ntpath.normcase(root_normalized)
    candidate_case = ntpath.normcase(candidate)
    if candidate_case != root_case and not candidate_case.startswith(root_case + "\\"):
        raise PathOutsideRoot("Đường dẫn nằm ngoài ổ marketing.")
    return candidate


def validate_download(path: str, max_bytes: int) -> int:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    if not os.path.isfile(path):
        raise InvalidTargetType("Lệnh /get chỉ nhận đường dẫn file.")
    size = os.path.getsize(path)
    if size > max_bytes:
        raise FileTooLarge(f"File có {size} byte, vượt giới hạn {max_bytes} byte.")
    return size


def list_directory(path: str, max_items: int = 80) -> tuple[list[str], bool]:
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    if not os.path.isdir(path):
        raise InvalidTargetType("Lệnh /ls chỉ nhận đường dẫn thư mục.")

    with os.scandir(path) as iterator:
        items = list(iterator)
    items.sort(key=lambda item: (not item.is_dir(), item.name.casefold()))
    truncated = len(items) > max_items
    result: list[str] = []
    for item in items[:max_items]:
        if item.is_dir():
            result.append(f"[THƯ MỤC] {item.name}")
        else:
            size_mb = item.stat().st_size / (1024 * 1024)
            result.append(f"[FILE] {item.name} ({size_mb:.1f} MB)")
    return result, truncated
