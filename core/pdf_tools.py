"""
Операции над PDF, которые не сводятся к "формат А -> формат В":
объединение (много файлов -> один), разделение (один -> много), сжатие (один -> один, но меньше).
"""

import shutil
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterator

import pymupdf

from core import images
from core.errors import ConversionError, UnsupportedConversion
from core.pdf import _open as open_pdf
from core.utils import resolve_output

Options = dict[str, Any]

SAVE_KWARGS = {"garbage": 3, "deflate": True}


# --- объединение ---


@contextmanager
def _as_pdf(path: Path, options: Options) -> Iterator["pymupdf.Document"]:
    """Любой поддериживаемый файл (PDF или картинка) как PDF-документ"""
    if path.suffix.lower() == ".pdf":
        doc = open_pdf(path)
        try:
            yield doc
        finally:
            doc.close()
        return

    img = images.read_image(path, options)
    with tempfile.TemporaryDirectory() as tmp:
        page_pdf = Path(tmp) / "page.pdf"
        images.write_pdf(img, page_pdf, {**options, "overwrite": True})
        doc = pymupdf.open(page_pdf)
        try:
            yield doc
        finally:
            doc.close()


def merge(sources: list[Path], output: Path | None, options: Options) -> list[Path]:
    """PDF и картинки -> один PDF в порядке списка. Закладки (оглавление) не переносятся."""
    if len(sources) < 2:
        raise ConversionError("Для объединения нужно минимум два файла")

    default = sources[0].with_name(f"{sources[0].stem}_merged.pdf")
    target = resolve_output(output or default, options.get("overwrite", False))

    merged = pymupdf.open()
    try:
        for path in sources:
            try:
                with _as_pdf(path, options) as part:
                    merged.insert_pdf(part)
            except ConversionError as e:
                raise ConversionError(f"{path.name}: {e}") from e
        merged.save(target, **SAVE_KWARGS)
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        merged.close()
    return [target]


# --- разделение ---
def _parse_ranges(spec: str, total: int) -> list[tuple[int, int]]:
    """1-3, 5, 7-' -> [(1, 3), (5, 5), (7, total)]. Нумерация страниц с единицы, как в любом просмотрщике"""
    ranges = []
    for token in (t.strip() for t in spec.split(",")):
        if not token:
            continue
        try:
            if "-" in token:
                left, right = token.split("-", 1)
                first = int(left) if left.strip() else 1
                last = int(right) if right.strip() else total
            else:
                first = last = int(token)
        except ValueError:
            raise ConversionError(
                f"Непонятный диапазон: '{token}'. Пример: 1-3, 5, 7-"
            ) from None
        if first > last:
            raise ConversionError(f"В диапазоне '{token}' начало больше конца")
        if first < 1 or last > total:
            raise ConversionError(f"Диапаон '{token}' вне документа (страниц: {total})")
        ranges.append((first, last))
    if not ranges:
        raise ConversionError("Не указано ни одного диапазона")
    return ranges


def plan_split(total: int, options: Options) -> list[tuple[int, int]]:
    """Какие диапазоны страниц (с единицы, включительно) получатся при разделении."""
    if total < 2:
        raise ConversionError("В документе одна страница, делить нечего")
    if options.get("ranges"):
        return _parse_ranges(options["ranges"], total)
    every = int(options.get("every") or 1)
    if every < 1:
        raise ConversionError("Число страниц в части должно быть не меньше 1")
    return [(a, min(a + every - 1, total)) for a in range(1, total + 1, every)]


def _part_name(stem: str, first: int, last: int, total: int) -> str:
    width = len(str(total))
    if first == last:
        return f"{stem}_page-{first:0{width}d}.pdf"
    return f"{stem}_pages-{first:0{width}d}-{last:0{width}d}.pdf"


def preview_split(src: Path, options: Options) -> list[dict]:
    """что получится при раздлелении, без создания файлов (для предпросмотра в окне)"""
    doc = open_pdf(src)
    try:
        total = doc.page_count
    finally:
        doc.close()
    return [
        {"name": _part_name(src.stem, a, b, total), "pages": b - a + 1}
        for a, b in plan_split(total, options)
    ]


def split(sources: list[Path], output: Path | None, options: Options) -> list[Path]:
    """Один PDF -> несколько. Опции: ranges='1-3,5,7-' (файл на диапазон) или every=N (файл на N страниц)."""
    src = sources[0]
    base = output or src  # из base берётся только папка и имя; расширение всегда .pdf
    overwrite = options.get("overwrite", False)

    doc = open_pdf(src)
    outputs: list[Path] = []
    try:
        total = doc.page_count
        for first, last in plan_split(total, options):
            name = _part_name(base.stem, first, last, total)
            target = resolve_output(base.with_name(name), overwrite)

            part = pymupdf.open()
            try:
                part.insert_pdf(
                    doc, from_page=first - 1, to_page=last - 1
                )  # здесь страницы с нуля
                part.save(target, **SAVE_KWARGS)
            finally:
                part.close()
            outputs.append(target)
    except Exception:
        for path in outputs:  # не оставляем половину частей
            path.unlink(missing_ok=True)
        raise
    finally:
        doc.close()
    return outputs


# --- сжатие ---

# уровень -> параметры пережатия картинок внутри PDF (None = только без потерь)
COMPRESS_LEVELS: dict[str, dict | None] = {
    "low": None,
    "medium": {"dpi_threshold": 200, "dpi_target": 150, "quality": 80},
    "high": {"dpi_threshold": 130, "dpi_target": 100, "quality": 60},
}


def compress(sources: list[Path], output: Path | None, options: Options) -> list[Path]:
    """Уровни: low - без потерь, medium - картинки до 150 DPI, high - до 100 DPI с большим сжатием"""
    src = sources[0]
    level = options.get("level", "medium")
    if level not in COMPRESS_LEVELS:
        raise ConversionError(
            f"Неизвестный уровень сжатия: {level} (доступно: {', '.join(COMPRESS_LEVELS)})"
        )

    target = resolve_output(
        output or src.with_name(f"{src.stem}_compressed.pdf"),
        options.get("overwrite", False),
    )

    doc = open_pdf(src)
    try:
        image_params = COMPRESS_LEVELS[level]
        if image_params:
            doc.rewrite_images(**image_params)
        doc.save(
            target,
            garbage=4,
            deflate=True,
            deflate_images=True,
            deflate_fonts=True,
            use_objstms=1,
        )
    except Exception:
        target.unlink(missing_ok=True)
        raise
    finally:
        doc.close()

    if target.stat().st_size >= src.stat().st_size:
        shutil.copyfile(src, target)
    return [target]


# --- реестр операций ---


@dataclass(frozen=True)
class Operation:
    id: str
    title: str
    accepts: tuple[str, ...]
    multi: bool
    run: Callable[[list[Path], Path | None, Options], list[Path]]


OPERATIONS: dict[str, Operation] = {
    op.id: op
    for op in (
        Operation("merge", "Объединить", (".pdf", *images.READ_EXTS), True, merge),
        Operation("split", "Разделить", (".pdf",), False, split),
        Operation("compress", "Сжать", (".pdf",), False, compress),
    )
}


def run_operation(
    op_id: str,
    sources: list[Path],
    options: Options | None = None,
    output: Path | None = None,
) -> list[Path]:
    op = OPERATIONS.get(op_id)
    if op is None:
        raise UnsupportedConversion(f"Неизвестная операция: {op_id}")
    if not sources:
        raise ConversionError("Не выбраны файлы")
    if not op.multi and len(sources) != 1:
        raise ConversionError(f"Операция «{op.title}» работает с одним файлом")

    for path in sources:
        if not path.exists():
            raise ConversionError(f"Файл не найден: {path}")
        if path.suffix.lower() not in op.accepts:
            raise UnsupportedConversion(
                f"{path.name}: формат {path.suffix} не подходит для '{op.title}'"
            )
    return op.run(sources, output, options or {})
