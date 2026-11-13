import shutil
from pathlib import Path
from typing import Any

from PIL import Image, ImageOps, UnidentifiedImageError

from core.errors import ConversionError
from core.utils import resolve_output

Options = dict[str, Any]

READ_EXTS = [".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif", ".tif", ".tiff"]

# HEIC (фото с iPhone) - необязательная зависимость: pip install pillow-heif
try:
    import pillow_heif

    pillow_heif.register_heif_opener()
    READ_EXTS += [".heic", ".heif"]
except ImportError:
    pass

_ICC_MODES = {"RGB", "RGBA", "L", "LA", "P"}


# --- читатель ---


def read_image(path: Path, options: Options) -> Image.Image:
    try:
        img = Image.open(path)
        img.load()
    except UnidentifiedImageError:
        raise ConversionError(
            "Не удалоь распознать изображение (файл поврежден или это не картинка)"
        ) from None
    except Image.DecompressionBombError:
        raise ConversionError("Слишком большое изображение") from None
    except OSError as e:
        raise ConversionError(f"Не удалось прочитать изображение: {e}") from e

    return ImageOps.exif_transpose(img)


# --- вспомогательное ---


def _has_alpha(img: Image.Image) -> bool:
    return img.mode in ("RGBA", "LA", "PA") or (
        img.mode == "P" and "transparency" in img.info
    )


def _flatten(img: Image.Image, background: str) -> Image.Image:
    """В RGB без прозраности: полупрозрачные пиксели смешиваются с фоном (по умолчанию белым)"""
    if _has_alpha(img):
        rgba = img.convert("RGBA")
        base = Image.new("RGB", rgba.size, background)
        base.paste(rgba, mask=rgba.getchannel("A"))
        return base
    return img.convert("RGB")


def _rgb_or_rgba(img: Image.Image) -> Image.Image:
    return img.convert("RGBA" if _has_alpha(img) else "RGB")


def _icc(img: Image.Image) -> dict:
    """Цветовой профиль переносим, только если он описывает режим, который мы не меняет радикально."""
    profile = img.info.get("icc_profile")
    return {"icc_profile": profile} if profile and img.mode in _ICC_MODES else {}


def _quality(options: Options) -> int:
    return max(1, min(100, int(options.get("quality", 90))))


def _save(
    img: Image.Image, dst: Path, options: Options, fmt: str, **kwargs
) -> list[Path]:
    target = resolve_output(dst, options.get("overwrite", False))
    try:
        img.save(target, format=fmt, **kwargs)
    except Exception as e:
        target.unling(missing_ok=True)
        raise ConversionError(f"Не удалось сохранить {fmt}: {e}") from e
    return [target]


# --- писатели ---
def write_jpg(img: Image.Image, dst: Path, options: Options) -> list[Path]:
    icc = _icc(img)
    flat = _flatten(img, options.get("background", "white"))
    return _save(
        flat, dst, options, "JPEG", quality=_quality(options), optimize=True, **icc
    )


def write_png(img: Image.Image, dst: Path, options: Options) -> list[Path]:
    icc = _icc(img)
    if img.mode in ("CMYK", "YCbCr", "LAB", "HSV"):
        img = img.convert("RGB")
    return _save(img, dst, options, "PNG", optimize=True, **icc)


def write_webp(img: Image.Image, dst: Path, options: Options) -> list[Path]:
    icc = _icc(img)
    return _save(
        _rgb_or_rgba(img), dst, options, "WEBP", quality=_quality(options), **icc
    )


def write_bmp(img: Image.Image, dst: Path, options: Options) -> list[Path]:
    # прозрачность в BMP поддерживается плохо, поэтому сводим к RGB
    return _save(_flatten(img, options.get("background", "white")), dst, options, "BMP")


def write_gif(img: Image.Image, dst: Path, options: Options) -> list[Path]:
    return _save(_rgb_or_rgba(img), dst, options, "GIF")


def write_tiff(img: Image.Image, dst: Path, options: Options) -> list[Path]:
    icc = _icc(img)
    return _save(img, dst, options, "TIFF", compression="tiff_lzw", **icc)


def write_pdf(img: Image.Image, dst: Path, options: Options) -> list[Path]:
    """Одна картинка -> одностраничный PDF; размер страницы = размер картинки при заданном DPI"""
    dpi = float(options.get("dpi", 150))
    flat = _flatten(img, options.get("background", "white"))
    return _save(flat, dst, options, "PDF", resolution=dpi, quality=_quality(options))


WRITERS = {
    ".jpg": write_jpg,
    ".png": write_png,
    ".webp": write_webp,
    ".bmp": write_bmp,
    ".gif": write_gif,
    ".tiff": write_tiff,
    ".pdf": write_pdf,
}

# ---------- уменьшение фото ----------

# PNG и WebP остаются собой, все остальное (JPEG, HEIC, BMP, TIFF, GIF) при уменьшении становится JPEG
_SHRINK_KEEP = {".png": ".png", ".webp": ".webp"}
# Эти расширения означают один и тот же формат (нужно, чтобы понять "формат не поменялся")
_SAME_FORMAT = {".jpeg": ".jpg", ".tif": ".tiff"}


def shrink_ext(path):
    """В каком расширении сохранится уменьшенное фото."""
    return _SHRINK_KEEP.get(path.suffix.lower(), ".jpg")


def shrink(sources, output, options):
    src = sources[0]
    try:
        max_side = max(0, int(options.get("max_side") or 0))
    except (TypeError, ValueError):
        raise ConversionError("Максимальный размер должен быть числом") from None

    target = output or src.with_name(f"{src.stem}_small{shrink_ext(src)}")
    img = read_image(src, options)
    resized = bool(max_side) and max(img.size) > max_side
    if resized:
        # thumbnail меняет размер на месте, сохраняет пропорции и никогда не увеличивает
        img.thumbnail((max_side, max_side), Image.Resampling.LANCZOS)

    [result] = WRITERS[target.suffix.lower()](img, target, options)

    # Размер не менялся, формат тот же, а файл вышел не легче: отдаем оригинал как есть
    same_format = (
        _SAME_FORMAT.get(src.suffix.lower(), src.suffix.lower())
        == result.suffix.lower()
    )
    if not resized and same_format and result.stat().st_size >= src.stat().st_size:
        shutil.copyfile(src, result)
    return [result]
