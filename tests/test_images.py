import pymupdf
import pytest
from PIL import Image

from core.errors import ConversionError, UnsupportedConversion
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


# ---------- уменьшение фото ----------


def make_photo(path, size=(1600, 1200), fmt="JPEG"):
    from PIL import Image

    Image.effect_noise(size, 60).convert("RGB").save(path, fmt, quality=95)
    return path


def test_shrink_resizes_long_side_and_keeps_proportions(tmp_path):
    from PIL import Image

    from core.images import shrink

    src = make_photo(tmp_path / "p.jpg")
    [out] = shrink([src], None, {"max_side": 800, "quality": 80})
    assert out.name == "p_small.jpg"
    with Image.open(out) as img:
        assert img.size == (
            800,
            600,
        )  # 1600x1200 -> длинная сторона 800, пропорции сохранены
    assert out.stat().st_size < src.stat().st_size


def test_shrink_never_upscales(tmp_path):
    from PIL import Image

    from core.images import shrink

    src = make_photo(tmp_path / "small.jpg", size=(400, 300))
    [out] = shrink([src], None, {"max_side": 2000, "quality": 70})
    with Image.open(out) as img:
        assert img.size == (400, 300)


def test_shrink_keeps_png_and_turns_others_into_jpeg(tmp_path):
    from PIL import Image

    from core.images import shrink, shrink_ext

    png = make_photo(tmp_path / "a.png", fmt="PNG")
    assert (
        shrink_ext(png) == ".png"
        and shrink_ext(tmp_path / "b.bmp") == ".jpg"
        and shrink_ext(tmp_path / "c.jpeg") == ".jpg"
    )
    [out] = shrink([png], None, {"max_side": 500})
    assert out.suffix == ".png"
    with Image.open(out) as img:
        assert max(img.size) == 500
    bmp = tmp_path / "b.bmp"
    Image.new("RGB", (300, 200), "red").save(bmp)
    assert shrink([bmp], None, {"max_side": 0})[0].suffix == ".jpg"


def test_shrink_does_not_make_file_heavier(tmp_path):
    from PIL import Image

    from core.images import shrink

    src = tmp_path / "tiny.jpg"
    Image.new("RGB", (64, 64), "white").save(src, quality=10, optimize=True)
    [out] = shrink(
        [src], None, {"max_side": 0, "quality": 95}
    )  # размер не меняем, качество выше: файл вышел бы тяжелее
    assert out.stat().st_size == src.stat().st_size


def test_shrink_rejects_garbage_size(tmp_path):
    from core.images import shrink

    with pytest.raises(ConversionError, match="числом"):
        shrink(
            [make_photo(tmp_path / "p.jpg", size=(100, 100))],
            None,
            {"max_side": "много"},
        )
