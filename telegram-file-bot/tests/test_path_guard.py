import os
from pathlib import Path

import pytest

from path_guard import (
    FileTooLarge,
    InvalidTargetType,
    PathOutsideRoot,
    list_directory,
    resolve_user_path,
    validate_download,
)


ROOT = r"\\192.168.1.6\marketing"


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (r"CHUNG\THIET KE\Danh", r"\\192.168.1.6\marketing\CHUNG\THIET KE\Danh"),
        (r"CHUNG\THIET KE\Danh\THÁNG 8", r"\\192.168.1.6\marketing\CHUNG\THIET KE\Danh\THÁNG 8"),
        (r"\\192.168.1.6\marketing\CHUNG\file.psd", r"\\192.168.1.6\marketing\CHUNG\file.psd"),
    ],
)
def test_resolve_user_path_accepts_relative_full_and_unicode(raw, expected):
    assert resolve_user_path(raw, ROOT) == expected


@pytest.mark.parametrize(
    "raw",
    [
        r"..\secret.txt",
        r"CHUNG\..\secret.txt",
        r"\\192.168.1.6\marketing-secret\file.txt",
        r"\\192.168.1.6\finance\file.txt",
        r"\\?\C:\Windows\win.ini",
        r"\\.\PhysicalDrive0",
    ],
)
def test_resolve_user_path_rejects_escape_attempts(raw):
    with pytest.raises(PathOutsideRoot):
        resolve_user_path(raw, ROOT)


def test_resolve_user_path_empty_value_returns_root():
    assert resolve_user_path("", ROOT) == ROOT


def test_validate_download_accepts_file_at_limit(tmp_path: Path):
    file_path = tmp_path / "design.psd"
    file_path.write_bytes(b"1234")
    assert validate_download(str(file_path), 4) == 4


def test_validate_download_rejects_oversized_file(tmp_path: Path):
    file_path = tmp_path / "design.psd"
    file_path.write_bytes(b"12345")
    with pytest.raises(FileTooLarge):
        validate_download(str(file_path), 4)


def test_validate_download_rejects_directory(tmp_path: Path):
    with pytest.raises(InvalidTargetType):
        validate_download(str(tmp_path), 100)


def test_list_directory_sorts_and_reports_truncation(tmp_path: Path):
    (tmp_path / "z-file.txt").write_text("z", encoding="utf-8")
    (tmp_path / "A-folder").mkdir()
    (tmp_path / "b-file.txt").write_text("b", encoding="utf-8")

    entries, truncated = list_directory(str(tmp_path), max_items=2)

    assert entries == ["[THƯ MỤC] A-folder", "[FILE] b-file.txt (0.0 MB)"]
    assert truncated is True
