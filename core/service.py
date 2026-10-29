"""Слой между интерфейсом (окном) и ядром: принимает и отдает только простые данные (dict, list, str),
которые без проблем ходят через мост pywebview. Ничего не знает про окно, поэтому тестируется отдельно.
"""

import subprocess
import sys
from functools import wraps
from pathlib import Path
from typing import Any, Callable

import pymupdf
from PIL import Image

from core import images
from core.errors import ConversionError
from core.pdf_tools import OPERATIONS, preview_split, run_operation
from core.registry import (
    CONVERTERS,
    convert,
    supported_formats,
    targets_for,
)  # noqa: F401 (supported_formats нужен app.py)
from core.utils import format_size

# что окно вообще имеет право передавать в качестве настроек (все остальное отбрасывается)
DEFAULT_OPTIONS: dict[str, Any] = {
    "delimiter": ";",  # русский Excel открывает CSV только с точкой с запятой
    "quality": 90,
    "dpi": 150,
    "background": "white",
    "level": "medium",
}
ALLOWED_OPTIONS = set(DEFAULT_OPTIONS) | {"ranges", "every"}

TABLE_EXTS = {".xlsx", ".xlsm", ".xls", ".csv", ".tsv"}


def clean_options(raw: dict | None) -> dict:
    options = dict(DEFAULT_OPTIONS)
    options.update({k: v for k, v in (raw or {}).items() if k in ALLOWED_OPTIONS})
    options["overwrite"] = False  # из окна существующие файлы не перезаписываем никогда
    return options


def _guard(func: Callable) -> Callable:
    """Любая ошибка превращается в {'ok': False, 'error': '...'}: окну не нужны traceback'и."""

    @wraps(func)
    def wrapper(*args, **kwargs):
        try:
            return func(*args, **kwargs)
        except ConversionError as e:
            return {"ok": False, "error": str(e)}
        except Exception as e:  # непредвиденное: показываем коротко, а не роняем окно
            return {"ok": False, "error": f"Неожиданная ошибка: {e}"}

    return wrapper


# ---------- сведения о файлах ----------


def _kind(ext: str) -> str:
    if ext == ".pdf":
        return "pdf"
    if ext in TABLE_EXTS:
        return "table"
    if ext in images.READ_EXTS:
        return "image"
    return "other"


def describe_file(path: Path, with_targets: bool = True) -> dict:
    """Все, что окно показывает про файл: имя, размер, страницы или размеры картинки, доступные форматы."""
    ext = path.suffix.lower()
    size = path.stat().st_size
    info = {
        "path": str(path),
        "name": path.name,
        "ext": ext,
        "kind": _kind(ext),
        "size": size,
        "size_text": format_size(size),
        "pages": None,
        "dims": None,
        "note": None,
        "targets": targets_for(path) if with_targets else [],
    }
    try:
        if ext == ".pdf":
            doc = pymupdf.open(path)
            try:
                if doc.needs_pass:
                    info["note"] = "Защищен паролем"
                else:
                    info["pages"] = doc.page_count
            finally:
                doc.close()
        elif info["kind"] == "image":
            with Image.open(
                path
            ) as img:  # читается только заголовок, картинка целиком не грузится
                info["dims"] = f"{img.width} × {img.height}"
    except Exception:
        info["note"] = "Не удалось прочитать файл"
    return info


def all_source_exts() -> list[str]:
    return sorted({src for (src, _dst) in CONVERTERS})


def operations() -> list[dict]:
    return [
        {"id": op.id, "title": op.title, "multi": op.multi, "accepts": list(op.accepts)}
        for op in OPERATIONS.values()
    ]


def dialog_filters(accept: list[str] | None) -> tuple[str, ...]:
    """Фильтр для диалога выбора файла: показывает только то, что приложение умеет открывать."""
    exts = sorted(set(accept or all_source_exts()))
    return (f"Поддерживаемые файлы ({';'.join('*' + e for e in exts)})",)


# ---------- действия ----------


def _result(sources: list[Path], outputs: list[Path]) -> dict:
    source_size = sum(p.stat().st_size for p in sources)
    result = {
        "ok": True,
        "source_size": source_size,
        "source_size_text": format_size(source_size),
        "outputs": [describe_file(p, with_targets=False) for p in outputs],
    }
    if len(sources) == 1 and len(outputs) == 1 and source_size:
        # для сжатия: на сколько процентов файл стал меньше (не бывает отрицательным)
        result["saved_percent"] = max(
            0, round(100 * (1 - outputs[0].stat().st_size / source_size))
        )
    return result


@_guard
def convert_file(src: str, target_ext: str, raw_options: dict | None = None) -> dict:
    src_path = Path(src)
    outputs = convert(
        src_path, src_path.with_suffix(target_ext), clean_options(raw_options)
    )
    return _result([src_path], outputs)


@_guard
def run_tool(op_id: str, paths: list[str], raw_options: dict | None = None) -> dict:
    sources = [Path(p) for p in paths]
    outputs = run_operation(op_id, sources, clean_options(raw_options))
    return _result(sources, outputs)


@_guard
def split_preview(path: str, raw_options: dict | None = None) -> dict:
    parts = preview_split(Path(path), clean_options(raw_options))
    return {"ok": True, "parts": parts}


def reveal_in_folder(path: str) -> None:
    """Открывает папку с файлом в проводнике системы и выделяет файл (где это умеет система)."""
    target = Path(path)
    if not target.exists():
        return
    if sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(target)])
    elif sys.platform.startswith("win"):
        subprocess.Popen(
            f'explorer /select,"{target}"'
        )  # строкой: список аргументов explorer понимает хуже
    else:
        subprocess.Popen(["xdg-open", str(target.parent)])
