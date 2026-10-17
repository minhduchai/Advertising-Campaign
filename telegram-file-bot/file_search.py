"""Chuẩn hóa link và tìm file gần đúng trong ổ marketing."""

from __future__ import annotations

import json
import ntpath
import os
import re
import threading
import time
import unicodedata
from dataclasses import dataclass
from difflib import SequenceMatcher
from urllib.parse import unquote, urlsplit

import requests


def normalize_shared_path(raw: str) -> str:
    value = (raw or "").strip().strip("<>\"'")
    if re.match(r"^(?:smb|file)://", value, re.IGNORECASE):
        parsed = urlsplit(value)
        value = f"//{parsed.netloc}{unquote(parsed.path)}"
    return unquote(value).replace("/", "\\")


def _search_key(value: str) -> str:
    plain = unicodedata.normalize("NFD", value.casefold().replace("đ", "d"))
    return re.sub(r"[^a-z0-9]+", " ", "".join(c for c in plain if not unicodedata.combining(c))).strip()


def calculate_similarity(input_filename: str, candidate_filename: str) -> float:
    # Giữ vị trí token để thưởng đúng mã ngày và chu kỳ chạy quảng cáo.
    def parts(name: str) -> list[str]:
        stem = ntpath.splitext(name)[0]
        return [_search_key(part) for part in stem.split("_")] if "_" in stem else (_search_key(stem).split() or [""])

    left, right = parts(input_filename), parts(candidate_filename)
    sequence = SequenceMatcher(None, " ".join(left), " ".join(right), autojunk=False).ratio()
    tokens = len(set(filter(None, left)) & set(filter(None, right))) / max(len(left), len(right))
    date_bonus = 0.1 if len(left) > 1 and len(right) > 1 and re.fullmatch(r"\d{4}", left[1]) and left[1] == right[1] else 0.0
    month_bonus = 0.1 if re.fullmatch(r"t\d{1,2}(?: t\d{1,2})*", left[-1]) and left[-1] == right[-1] else 0.0
    return min(1.0, sequence * 0.5 + tokens * 0.3 + date_bonus + month_bonus)


def _is_within(path: str, root: str) -> bool:
    path_case = ntpath.normcase(ntpath.normpath(path))
    root_case = ntpath.normcase(ntpath.normpath(root))
    return path_case == root_case or path_case.startswith(root_case + "\\")


@dataclass(frozen=True)
class FileMatch:
    path: str
    score: float
    is_exact_alternative: bool = False


# Giới hạn cả số luồng SMB bị treo; hết hạn không tạo thêm quét không giới hạn.
_search_slots = threading.BoundedSemaphore(4)


def find_file_matches(root: str, requested_path: str, limit: int = 5, timeout_seconds: float = 3.0) -> list[FileMatch]:
    from path_guard import resolve_user_path

    target = resolve_user_path(requested_path, root)
    parent, wanted = ntpath.split(target)
    deadline = time.monotonic() + timeout_seconds
    stopped, finished = threading.Event(), threading.Event()
    candidates: list[FileMatch] = []
    errors: list[Exception] = []

    def expired() -> bool:
        return stopped.is_set() or time.monotonic() >= deadline

    def directories(folder: str):
        with os.scandir(folder) as entries:
            for entry in entries:
                if expired():
                    return
                if not entry.is_symlink() and not getattr(entry, "is_junction", lambda: False)() and entry.is_dir(follow_symlinks=False):
                    yield entry

    def scan(folder: str, depth: int = 0) -> None:
        if expired():
            return
        children = []
        with os.scandir(folder) as entries:
            for entry in entries:
                if expired():
                    return
                if entry.is_symlink() or getattr(entry, "is_junction", lambda: False)():
                    continue
                if entry.is_file(follow_symlinks=False):
                    score = calculate_similarity(wanted, entry.name)
                    if score >= 0.55:
                        same_parent = ntpath.normcase(folder) == ntpath.normcase(parent)
                        candidates.append(FileMatch(entry.path, score, same_parent and score >= 0.90))
                elif depth < 1 and entry.is_dir(follow_symlinks=False):
                    children.append(entry.path)
        for child in children:
            try:
                scan(child, depth + 1)
            except OSError:
                continue

    def search() -> None:
        try:
            if os.path.isfile(target):
                candidates.append(FileMatch(target, 1.0, True))
                return
            folder, missing = parent, []
            while not expired() and not os.path.isdir(folder):
                ancestor, part = ntpath.split(folder)
                if not part or ancestor == folder or not _is_within(ancestor, root):
                    return
                missing.insert(0, part)
                folder = ancestor
            # Chỉ sửa tối đa hai cấp thư mục, chọn một nhánh gần nhất.
            if len(missing) > 2:
                return
            for part in missing:
                best_path, best_score = "", 0.6
                for entry in directories(folder):
                    score = SequenceMatcher(None, _search_key(part), _search_key(entry.name), autojunk=False).ratio()
                    if score > best_score or (score == best_score and entry.path < best_path):
                        best_path, best_score = entry.path, score
                if not best_path or expired():
                    return
                folder = best_path
            scan(folder)
        except Exception as exc:
            errors.append(exc)
        finally:
            finished.set()
            _search_slots.release()

    if not _search_slots.acquire(blocking=False):
        raise TimeoutError("Ổ mạng đang bận xử lý các lần tìm trước. Anh thử lại sau nhé.")
    worker = threading.Thread(target=search, daemon=True, name="file-search")
    try:
        worker.start()
    except Exception:
        _search_slots.release()
        raise
    completed = finished.wait(max(0.0, deadline - time.monotonic()))
    stopped.set()
    matches = sorted(candidates.copy(), key=lambda match: (-match.score, match.path.casefold()))[:limit]
    if not completed and not matches:
        raise TimeoutError("Đã hết 3 giây tìm kiếm; ổ mạng phản hồi chậm. Anh thử lại nhé.")
    if errors and not matches:
        raise errors[0]
    return [FileMatch(match.path, match.score, index == 0 and match.is_exact_alternative) for index, match in enumerate(matches)]


def find_similar_files(root: str, requested_path: str, extra_terms: list[str] | None = None, limit: int = 5) -> list[str]:
    return [match.path for match in find_file_matches(root, requested_path, limit)]


class GeminiPathAnalyzer:
    def __init__(self, api_key: str, model: str = "gemini-3.8-flash"):
        self.api_key = api_key
        self.model = model

    def analyze(self, raw_path: str) -> tuple[list[str], str]:
        if not self.api_key:
            return [], ""
        prompt = (
            "Phân tích tên file/đường dẫn bị sai để tìm trên NAS. Chỉ tách các từ khóa đặc trưng "
            "(mã sản phẩm, người, ngày, chiến dịch), không bịa đường dẫn. Trả JSON gồm keywords "
            "(tối đa 8 chuỗi) và advice (một câu tiếng Việt hướng dẫn người dùng).\nĐường dẫn: "
            + raw_path
        )
        response = requests.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent",
            headers={"x-goog-api-key": self.api_key},
            json={
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {"responseMimeType": "application/json"},
            },
            timeout=15,
        )
        response.raise_for_status()
        text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        data = json.loads(text)
        keywords = [str(value) for value in data.get("keywords", [])[:8]]
        return keywords, str(data.get("advice", ""))[:500]
