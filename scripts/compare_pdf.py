"""Сравнение PyMuPDF и pypdf + pypdfium2 на ваших PDF.

Запуск:  python scripts/compare_pdf.py файл1.pdf файл2.pdf ...
Результаты (PDF и картинки) складываются в папку compare_out/, чтобы можно было сравнить глазами.
"""

import sys
import time
from pathlib import Path

import pymupdf
import pypdf
import pypdfium2

OUT = Path("compare_out")
RENDER_PAGES = 5  # сколько первых страниц рисуем и читаем
DPI = 150


def timed(func):
    """Выполняет func(), возвращает (результат, секунды)."""
    start = time.perf_counter()
    result = func()
    return result, time.perf_counter() - start


def kb(path: Path) -> str:
    return f"{path.stat().st_size / 1024:,.0f} КБ".replace(",", " ")


def row(label: str, *cells: str) -> None:
    print(f"  {label:<22}" + "".join(f"{c:<24}" for c in cells))


# ---------- сжатие ----------


def compress_pymupdf(src: Path, dst: Path) -> None:
    doc = pymupdf.open(src)
    doc.rewrite_images(dpi_threshold=200, dpi_target=150, quality=80)
    doc.save(
        dst,
        garbage=4,
        deflate=True,
        deflate_images=True,
        deflate_fonts=True,
        use_objstms=1,
    )
    doc.close()


def compress_pypdf(src: Path, dst: Path) -> None:
    writer = pypdf.PdfWriter(clone_from=src)
    for page in writer.pages:
        page.compress_content_streams()
        for (
            image
        ) in (
            page.images
        ):  # pypdf умеет только пережимать JPEG-качеством, без уменьшения DPI
            try:
                image.replace(image.image, quality=80)
            except Exception:
                pass  # необычные форматы картинок просто оставляем как есть
    try:
        writer.compress_identical_objects(remove_identicals=True, remove_orphans=True)
    except Exception:
        pass  # у некоторых PDF (без блока Info) эта чистка в pypdf падает: пропускаем её
    with open(dst, "wb") as f:
        writer.write(f)


# ---------- объединение ----------


def merge_pymupdf(files: list[Path], dst: Path) -> None:
    merged = pymupdf.open()
    for f in files:
        with pymupdf.open(f) as part:
            merged.insert_pdf(part)
    merged.save(dst, garbage=3, deflate=True)
    merged.close()


def merge_pypdf(files: list[Path], dst: Path) -> None:
    writer = pypdf.PdfWriter()
    for f in files:
        writer.append(f)
    with open(dst, "wb") as out:
        writer.write(out)


# ---------- картинки и текст ----------


def render_pymupdf(src: Path, out_dir: Path) -> None:
    with pymupdf.open(src) as doc:
        for i in range(min(RENDER_PAGES, doc.page_count)):
            doc[i].get_pixmap(dpi=DPI).save(out_dir / f"page-{i + 1}.png")


def render_pypdfium(src: Path, out_dir: Path) -> None:
    pdf = pypdfium2.PdfDocument(src)
    for i in range(min(RENDER_PAGES, len(pdf))):
        pdf[i].render(scale=DPI / 72).to_pil().save(out_dir / f"page-{i + 1}.png")
    pdf.close()


def text_pymupdf(src: Path) -> str:
    with pymupdf.open(src) as doc:
        return "\n".join(
            doc[i].get_text() for i in range(min(RENDER_PAGES, doc.page_count))
        )


def text_pypdfium(src: Path) -> str:
    pdf = pypdfium2.PdfDocument(src)
    text = "\n".join(
        pdf[i].get_textpage().get_text_range()
        for i in range(min(RENDER_PAGES, len(pdf)))
    )
    pdf.close()
    return text


def text_pypdf(src: Path) -> str:
    reader = pypdf.PdfReader(src)
    return "\n".join(
        reader.pages[i].extract_text()
        for i in range(min(RENDER_PAGES, len(reader.pages)))
    )


def folder_size(folder: Path) -> str:
    total = sum(p.stat().st_size for p in folder.glob("*.png"))
    return f"{total / 1024:,.0f} КБ".replace(",", " ")


# ---------- прогон ----------


def compare_file(src: Path) -> None:
    print(f"\n=== {src.name}  ({kb(src)}) ===")
    work = OUT / src.stem
    work.mkdir(parents=True, exist_ok=True)

    print("Сжатие (картинки до 150 DPI, качество 80):")
    row("", "PyMuPDF", "pypdf")
    a, b = work / "compressed_pymupdf.pdf", work / "compressed_pypdf.pdf"
    _, ta = timed(lambda: compress_pymupdf(src, a))
    _, tb = timed(lambda: compress_pypdf(src, b))
    row("размер", kb(a), kb(b))
    row("время", f"{ta:.2f} с", f"{tb:.2f} с")

    print(f"Рисование первых {RENDER_PAGES} страниц ({DPI} DPI):")
    row("", "PyMuPDF", "pypdfium2")
    da, db = work / "render_pymupdf", work / "render_pypdfium"
    da.mkdir(exist_ok=True)
    db.mkdir(exist_ok=True)
    _, ta = timed(lambda: render_pymupdf(src, da))
    _, tb = timed(lambda: render_pypdfium(src, db))
    row("время", f"{ta:.2f} с", f"{tb:.2f} с")
    row("размер PNG", folder_size(da), folder_size(db))

    print("Извлечение текста:")
    row("", "PyMuPDF", "pypdfium2", "pypdf")
    texts = []
    for func in (text_pymupdf, text_pypdfium, text_pypdf):
        text, t = timed(lambda f=func: f(src))
        texts.append((len(text.split()), t))
    row("слов", *(str(n) for n, _ in texts))
    row("время", *(f"{t:.2f} с" for _, t in texts))


def main() -> None:
    files = [Path(p) for p in sys.argv[1:]]
    if not files:
        sys.exit("Укажите хотя бы один PDF: python scripts/compare_pdf.py файл.pdf")
    OUT.mkdir(exist_ok=True)
    for f in files:
        compare_file(f)

    if len(files) >= 2:
        print(f"\n=== Объединение всех файлов ({len(files)} шт.) ===")
        row("", "PyMuPDF", "pypdf")
        a, b = OUT / "merged_pymupdf.pdf", OUT / "merged_pypdf.pdf"
        _, ta = timed(lambda: merge_pymupdf(files, a))
        _, tb = timed(lambda: merge_pypdf(files, b))
        row("размер", kb(a), kb(b))
        row("время", f"{ta:.2f} с", f"{tb:.2f} с")

    print(f"\nГотовые файлы для сравнения глазами: {OUT.resolve()}")


if __name__ == "__main__":
    main()
