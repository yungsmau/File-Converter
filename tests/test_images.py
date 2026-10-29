import pymupdf
import pytest
from PIL import Image

from core.errors import UnsupportedConversion
from core.registry import convert, targets_for


@pytest.mark.parametrize("ext", [".jpg", ".webp", ".bmp", ".gif", ".tiff"])
def test_png_to_other_formats(tmp_path, make_png, ext):
    src = make_png()
    [out] = convert(src, tmp_path / f"out{ext}", {})
    with Image.open(out) as img:
        assert img.size == (120, 80)


def test_transparency_is_flattened_over_white_for_jpg(tmp_path, make_png):
    src = make_png("t.png", color=(0, 0, 0, 0), mode="RGBA")
    [out] = convert(src, tmp_path / "t.jpg", {})
    with Image.open(out) as img:
        assert img.getpixel((5, 5)) == (255, 255, 255)


def test_image_to_pdf(tmp_path, make_png):
    [out] = convert(make_png(), tmp_path / "p.pdf", {})
    doc = pymupdf.open(out)
    assert doc.page_count == 1
    doc.close()


def test_targets_do_not_offer_same_format(make_png):
    targets = targets_for(make_png())
    assert ".png" not in targets
    assert ".pdf" in targets


def test_unsupported_pair(tmp_path, make_png):
    with pytest.raises(UnsupportedConversion):
        convert(make_png(), tmp_path / "x.csv", {})
