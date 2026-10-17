from pathlib import Path
import threading
import time

import pytest

from file_search import calculate_similarity, find_file_matches, find_similar_files, normalize_shared_path


def test_normalize_shared_path_accepts_wrapped_and_url_encoded_link():
    assert normalize_shared_path("<smb://192.168.1.6/marketing/VIDEO%20FINAL/a.mp4>") == (
        r"\\192.168.1.6\marketing\VIDEO FINAL\a.mp4"
    )


def test_find_similar_files_ignores_accents_separators_and_small_typos(tmp_path: Path):
    expected = tmp_path / "VIDEO_1109_TUYETVAN_KHOA_DANH_KHOAA_NGHIA_CFURANHCUOI5000K_T09+T10.mp4"
    expected.write_bytes(b"video")
    (tmp_path / "unrelated.mp4").write_bytes(b"video")

    matches = find_similar_files(
        str(tmp_path),
        "video 1109 tuyet van khoa danh khoa nghia cfu ranh cuoi 5000k t09 t10.mp4",
    )

    assert matches[0] == str(expected)


def test_hybrid_score_is_bounded_and_rewards_date_and_month():
    name = "VIDEO_0910_NGÂN_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI99KNANNHAN_T10+T11.mp4"
    correct = name.replace("99K", "990K").replace("NGÂN", "NGAN")
    assert 0.90 <= calculate_similarity(name, correct) <= 1.0
    assert calculate_similarity(name, correct) > calculate_similarity(name, correct.replace("0910", "1009").replace("T10+T11", "T09+T10"))
    assert calculate_similarity("VIDEO_0910_ĐAN_T10+T11.mp4", "video_0910_dan_t10+t11.MOV") == pytest.approx(1.0)


def test_exact_file_returns_immediately_without_listing(tmp_path, monkeypatch):
    source = tmp_path / "video.mp4"
    source.write_bytes(b"video")
    monkeypatch.setattr("file_search.os.scandir", lambda _: pytest.fail("Exact match must not scan"))
    assert find_file_matches(str(tmp_path), str(source))[0].path == str(source)


def test_typo_folder_recovers_nearest_branch_and_one_child_level(tmp_path):
    target = tmp_path / "THÁNG 10" / "TRIỆT LÔNG" / "exports"
    target.mkdir(parents=True)
    name = "VIDEO_0910_NGAN_TRIETBIKINI990K_T10+T11.mp4"
    expected = target / name
    expected.write_bytes(b"video")
    wrong = tmp_path / "THÁNG 9"
    wrong.mkdir()
    (wrong / name).write_bytes(b"video")
    request = tmp_path / "THÁNG 10" / "TRIET LON" / name.replace("990K", "99K")
    matches = find_file_matches(str(tmp_path), str(request))
    assert [match.path for match in matches] == [str(expected)]
    assert not matches[0].is_exact_alternative


def test_existing_folder_does_not_fall_back_to_other_month(tmp_path):
    target = tmp_path / "THÁNG 10"
    target.mkdir()
    other = tmp_path / "THÁNG 9"
    other.mkdir()
    name = "VIDEO_0910_NGAN_TRIETBIKINI990K_T10+T11.mp4"
    (other / name).write_bytes(b"video")
    assert find_similar_files(str(tmp_path), str(target / name)) == []


def test_scope_skips_grandchildren(tmp_path):
    nested = tmp_path / "one" / "two"
    nested.mkdir(parents=True)
    (nested / "VIDEO_0910_NGAN_T10+T11.mp4").write_bytes(b"video")
    assert find_similar_files(str(tmp_path), "VIDEO_0910_NGAN_T10+T11.mp4") == []


def test_only_top_direct_candidate_gets_priority_flag(tmp_path):
    name = "VIDEO_0910_NGAN_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI990KNANNHAN_T10+T11.mp4"
    (tmp_path / name).write_bytes(b"video")
    (tmp_path / name.replace("990K", "9900K")).write_bytes(b"video")
    matches = find_file_matches(str(tmp_path), name.replace("990K", "99K"))
    assert matches[0].path == str(tmp_path / name)
    assert [match.is_exact_alternative for match in matches] == [True, False]


def test_search_rejects_outside_root(tmp_path):
    from path_guard import PathOutsideRoot

    with pytest.raises(PathOutsideRoot):
        find_file_matches(str(tmp_path), str(tmp_path.parent / "private" / "file.mp4"))


def test_blocked_smb_call_does_not_hold_caller_past_budget(tmp_path, monkeypatch):
    release = threading.Event()
    exited = threading.Event()

    def blocked(_):
        try:
            release.wait(2)
            return False
        finally:
            exited.set()

    monkeypatch.setattr("file_search.os.path.isfile", blocked)
    started = time.monotonic()
    try:
        with pytest.raises(TimeoutError):
            find_file_matches(str(tmp_path), "missing.mp4", timeout_seconds=0.05)
        assert time.monotonic() - started < 0.5
    finally:
        release.set()
        assert exited.wait(1)


def test_find_similar_files_searches_exact_parent_before_large_root(tmp_path: Path):
    target_folder = tmp_path / "THÁNG 10" / "ADS" / "TRIET LONG"
    target_folder.mkdir(parents=True)
    expected = target_folder / "VIDEO_0910_NGAN_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI990KNANNHAN_T10+T11.mp4"
    expected.write_bytes(b"video")
    (tmp_path / "VIDEO_1009_MAAY_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI990K_T09+T10.mp4").write_bytes(b"video")
    typo = target_folder / "VIDEO_0910_NGAN_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI90KNANNHAN_T10+T11.mp4"

    matches = find_similar_files(str(tmp_path), str(typo))

    assert matches[0] == str(expected)


def test_find_similar_files_prefers_longest_progressive_filename_prefix(tmp_path: Path):
    expected = tmp_path / "VIDEO_0910_NGAN_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI990KNANNHAN_T10+T11.mp4"
    expected.write_bytes(b"video")
    for name in (
        "VIDEO_1009_MAAY_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI990K_T09+T10.mp4",
        "VIDEO_0910_HONG_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI990K_T10+T11.mp4",
        "VIDEO_0910_NGAN_KHOA_KHAC_KHOAA_NGHIA_TRIETBIKINI99KNANNHAN_T10+T11.mp4",
    ):
        (tmp_path / name).write_bytes(b"video")

    matches = find_similar_files(
        str(tmp_path),
        str(tmp_path / "VIDEO_0910_NGAN_KHOA_DANH_KHOAA_NGHIA_TRIETBIKINI99KNANNHAN_T10+T11.mp4"),
    )

    assert matches[0] == str(expected)
