from pathlib import Path

import pymupdf
import pytest
from PIL import Image

from core.errors import ConversionError
from core.pdf_tools import plan_split, preview_split, run_operation
from core.registry import convert


def page_count(path: Path) -> int:
    doc = pymupdf.open(path)
    try:
        return doc.page_count
    finally:
        doc.close()


def test_pdf_to_images_one_file_per_page(tmp_path, make_pdf):
    src = make_pdf("d.pdf", pages=3)
    outs = convert(src, tmp_path / "d.png", {"dpi": 72})
    assert len(outs) == 3
    assert [p.name for p in outs] == ["d_page-01.png", "d_page-02.png", "d_page-03.png"]


def test_pdf_to_txt(tmp_path, make_pdf):
    src = make_pdf("d.pdf", pages=2)
    [out] = convert(src, tmp_path / "d.txt", {})
    text = out.read_text(encoding="utf-8")
    assert "d page 1" in text and "d page 2" in text


def test_merge_pdfs_and_images(tmp_path, make_pdf, make_png):
    a, b = make_pdf("a.pdf", 2), make_pdf("b.pdf", 3)
    [out] = run_operation("merge", [a, b, make_png()], {})
    assert out.name == "a_merged.pdf"
    assert page_count(out) == 6


def test_merge_needs_two_files(make_pdf):
    with pytest.raises(ConversionError, match="минимум два"):
        run_operation("merge", [make_pdf()], {})


def test_split_by_ranges(make_pdf):
    src = make_pdf("r.pdf", 12)
    outs = run_operation("split", [src], {"ranges": "1-3, 5, 11-"})
    assert [p.name for p in outs] == [
        "r_pages-01-03.pdf",
        "r_page-05.pdf",
        "r_pages-11-12.pdf",
    ]
    assert [page_count(p) for p in outs] == [3, 1, 2]


def test_split_every_n(make_pdf):
    outs = run_operation("split", [make_pdf("r.pdf", 5)], {"every": 2})
    assert [page_count(p) for p in outs] == [2, 2, 1]


def test_preview_matches_real_result(make_pdf):
    src = make_pdf("r.pdf", 12)
    options = {"ranges": "2-4, 9"}
    preview = [p["name"] for p in preview_split(src, options)]
    real = [p.name for p in run_operation("split", [src], options)]
    assert preview == real  # имена из предпросмотра совпадают с настоящими


@pytest.mark.parametrize(
    "ranges, message",
    [
        ("3-1", "начало больше конца"),
        ("1-99", "вне документа"),
        ("abc", "Непонятный"),
        (",", "ни одного"),
    ],
)
def test_bad_ranges(ranges, message):
    with pytest.raises(ConversionError, match=message):
        plan_split(10, {"ranges": ranges})


def test_single_page_cannot_be_split():
    with pytest.raises(ConversionError, match="одна страница"):
        plan_split(1, {"every": 1})


def test_compress_never_makes_file_bigger(make_pdf):
    src = make_pdf("c.pdf", 4)
    [out] = run_operation("compress", [src], {"level": "high"})
    assert out.name == "c_compressed.pdf"
    assert out.stat().st_size <= src.stat().st_size


def test_compress_shrinks_heavy_images(tmp_path):
    big = tmp_path / "big.png"
    Image.effect_noise((2400, 2400), 60).convert("RGB").save(
        big
    )  # шумная картинка плохо сжимается без потерь
    pdf = tmp_path / "big.pdf"
    doc = pymupdf.open()
    doc.new_page(width=300, height=300).insert_image(
        pymupdf.Rect(0, 0, 300, 300), filename=str(big)
    )
    doc.save(pdf)
    doc.close()
    [out] = run_operation("compress", [pdf], {"level": "high"})
    assert out.stat().st_size < pdf.stat().st_size


def test_password_protected_pdf_gives_readable_error(tmp_path, make_pdf):
    src = make_pdf("s.pdf", 2)
    locked = tmp_path / "locked.pdf"
    doc = pymupdf.open(src)
    doc.save(
        locked,
        encryption=pymupdf.PDF_ENCRYPT_AES_256,
        user_pw="secret",
        owner_pw="secret",
    )
    doc.close()
    with pytest.raises(ConversionError):
        run_operation("split", [locked], {"every": 1})


def test_broken_file_gives_readable_error(tmp_path):
    broken = tmp_path / "broken.pdf"
    broken.write_bytes("это не PDF".encode())
    with pytest.raises(ConversionError):
        run_operation("compress", [broken], {})


def test_unknown_operation_and_wrong_format(tmp_path, make_png):
    with pytest.raises(ConversionError):
        run_operation("rotate", [make_png()], {})
    with pytest.raises(ConversionError):
        run_operation("split", [make_png()], {"every": 1})


# ---------- организатор страниц ----------


def page_texts(path: Path) -> list[str]:
    doc = pymupdf.open(path)
    try:
        return [page.get_text().strip() for page in doc]
    finally:
        doc.close()


def test_organize_reorders_and_deletes(make_pdf):
    src = make_pdf("d.pdf", pages=4)
    pages = [
        {"page": 3},
        {"page": 1},
    ]  # вторую и четвертую убрали, остальные поменяли местами
    [out] = run_operation("organize", [src], {"pages": pages})
    assert out.name == "d_edited.pdf"
    assert page_texts(out) == ["d page 3", "d page 1"]


def test_organize_rotates_only_chosen_pages(make_pdf):
    src = make_pdf("d.pdf", pages=3)
    [out] = run_operation(
        "organize",
        [src],
        {"pages": [{"page": 1}, {"page": 2, "rotate": 90}, {"page": 3, "rotate": -90}]},
    )
    doc = pymupdf.open(out)
    try:
        assert [p.rotation for p in doc] == [0, 90, 270]
    finally:
        doc.close()


def test_organize_adds_rotation_to_existing_one(tmp_path, make_pdf):
    src = make_pdf("d.pdf", pages=1)
    doc = pymupdf.open(src)
    doc[0].set_rotation(90)
    doc.saveIncr()
    doc.close()
    [out] = run_operation("organize", [src], {"pages": [{"page": 1, "rotate": 180}]})
    result = pymupdf.open(out)
    try:
        assert result[0].rotation == 270  # 90 + 180
    finally:
        result.close()


def test_organize_can_repeat_a_page_with_own_rotation(make_pdf):
    src = make_pdf("d.pdf", pages=2)
    [out] = run_operation(
        "organize", [src], {"pages": [{"page": 2}, {"page": 2, "rotate": 90}]}
    )
    doc = pymupdf.open(out)
    try:
        assert [p.rotation for p in doc] == [0, 90]
        assert page_texts(out) == ["d page 2", "d page 2"]
    finally:
        doc.close()


@pytest.mark.parametrize(
    "pages, message",
    [
        ([], "ни одной страницы"),
        (None, "ни одной страницы"),
        ([{"page": 9}], "нет страницы 9"),
        ([{"page": 0}], "нет страницы 0"),
        ([{"page": 1, "rotate": 45}], "90, 180, 270"),
        ([{"nope": 1}], "составлен неверно"),
        (["1"], "составлен неверно"),
    ],
)
def test_organize_bad_pages(make_pdf, pages, message):
    src = make_pdf("d.pdf", pages=2)
    with pytest.raises(ConversionError, match=message):
        run_operation("organize", [src], {"pages": pages})
    assert not list(src.parent.glob("*_edited*"))  # неудача не оставляет файлов
