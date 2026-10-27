from pathlib import Path
from typing import Any, Callable, Iterator

import pymupdf
from PIL import Image

from core.errors import ConversionError
from core.utils import resolve_output

Options = dict[str, Any]

MAX_PIXELS = 150_000_000


def _open(path: Path) -> "pymupdf.Document":
    try:
        doc = pymupdf.open(path)
    except Exception as e:
        raise ConversionError(f"Не удалось открыть PDF: {e}") from e
    if doc.needs_pass:
        doc.close()
        raise ConversionError("PDF защищен паролем")
    return doc


class PdfPages:
    """
    Страница PDF, которые рендерятся по одной при переборе.

    Список готовых картинок для 300-страничного документа занял бы гигабайты памяти,
    поэтому каждая страница живет только пока писатель ее сохраняет.
    """

    def __init__(self, path: Path, dpi: int):
        self.doc = _open(path)
        self.dpi = dpi

    def __len__(self) -> int:
        return self.doc.page_count

    def __iter__(self) -> Iterator[Image.Image]:
        scale = self.dpi / 72  # в PDF 1 pt = 1/72 inches
        for page in self.doc:
            if page.rect.width * page.rect.height * scale**2 > MAX_PIXELS:
                raise ConversionError(
                    f"Страница слишком большая для {self.dpi} DPI, уменьшите DPI"
                )
            pix = page.get_pixmap(
                dpi=self.dpi, alpha=False
            )  # alpha=False - белый фон, не прозрачный
            yield Image.frombytes("RGB", (pix.width, pix.height), pix.samples)

    def __enter__(self) -> "PdfPages":
        return self

    def __exit__(self, *exc) -> None:
        self.doc.close()


def read_pages(path: Path, options: Options) -> PdfPages:
    dpi = int(options.get("dpi", 150))
    if not 36 <= dpi <= 600:
        raise ConversionError("DPI должен быть от 36 до 600")
    return PdfPages(path, dpi)


def per_page(image_writer: Callable) -> Callable:
    """Превращает писатель одной картинки в писатель всех страниц: <имя>_page-01.png"""

    def write(pages: PdfPages, dst: Path, options: Options) -> list[Path]:
        outputs: list[Path] = []
        try:
            with pages:
                n = len(pages)
                width = max(2, len(str(n)))
                for i, img in enumerate(pages, start=1):
                    target = (
                        dst
                        if n == 1
                        else dst.with_name(f"{dst.stem}_page-{i:0{width}d}{dst.suffix}")
                    )
                    outputs += image_writer(img, target, options)
        except Exception:
            for path in outputs:
                path.unlink(missing_ok=True)
            raise
        return outputs

    return write


def read_text(path: Path, options: Options) -> list[str]:
    doc = _open(path)
    try:
        pages = [page.get_text() for page in doc]
    finally:
        doc.close()
    if not any(p.strip() for p in pages):
        raise ConversionError("В PDF нет текстового слоя (похоже на скан), нужен OCR")
    return pages


def write_txt(pages: list[str], dst: Path, options: Options) -> list[Path]:
    target = resolve_output(dst, options.get("overwrite", False))
    target.write_text("\n\n".join(p.strip() for p in pages), encoding="utf-8")
    return [target]
