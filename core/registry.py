from pathlib import Path
from typing import Any, Callable

from core import images, pdf, tables
from core.errors import ConversionError, UnsupportedConversion

Options = dict[str, Any]
# конвертер принимает исходник, желаемый путь результата и опции; возвращает список созданных файлов
Converter = Callable[[Path, Path, Options], list[Path]]

CONVERTERS: dict[tuple[str, str], Converter] = {}
FAMILIES: list[dict] = (
    []
)  # для подсказки в интерфейсе: какие форматы открываем и сохраняем

# синонимы расширений: в списке "куда конвертировать" показываем только канонические
ALIASES = {".jpeg": ".jpg", ".tif": ".tiff"}


def canon(ext: str) -> str:
    return ALIASES.get(ext, ext)


def _make_pipeline(read, write) -> Converter:
    # отдельная фабрика, а не лямбда в цикле: иначе все лямбды замкнулись бы на последние read/write
    def run(src: Path, dst: Path, options: Options) -> list[Path]:
        data = read(
            src, options
        )  # что именно возвращает читатель (list[Sheet], Image...) знает только его писатель
        if not data:
            raise ConversionError("В файле нет данных")
        return write(data, dst, options)

    return run


def _register_family(
    name: str, readers: dict[str, Callable], writers: dict[str, Callable]
) -> None:
    """Из M читателей и N писателей получаем все M*N пар (кроме тождественных)."""
    # одно и то же имя можно регистрировать несколько раз (у PDF разные читатели): списки объединяются
    entry = next((f for f in FAMILIES if f["name"] == name), None)
    if entry is None:
        entry = {"name": name, "from": [], "to": []}
        FAMILIES.append(entry)
    entry["from"] += [
        e for e in readers if e not in ALIASES and e not in entry["from"]
    ]  # синонимы не показываем
    entry["to"] += [e for e in writers if e not in entry["to"]]
    for src_ext, read in readers.items():
        for dst_ext, write in writers.items():
            if canon(src_ext) != dst_ext:  # jpeg -> jpg перекодировать незачем
                CONVERTERS[(src_ext, dst_ext)] = _make_pipeline(read, write)


_register_family(
    "Таблицы",
    readers={
        ".xlsx": tables.read_xlsx,
        ".xlsm": tables.read_xlsx,
        ".xls": tables.read_xls,
        ".csv": tables.read_csv,
        ".tsv": tables.read_csv,
    },
    writers={
        ".xlsx": tables.write_xlsx,
        ".csv": tables.write_csv,
        ".tsv": tables.write_csv,
    },
)


_register_family(
    "Изображения",
    readers={ext: images.read_image for ext in images.READ_EXTS},
    writers=images.WRITERS,  # в том числе ".pdf": картинка -> одностраничный PDF
)

_register_family(
    "PDF",
    readers={".pdf": pdf.read_pages},
    # страницы PDF -> те же писатели картинок, только применённые к каждой странице (PDF -> PDF не нужен)
    writers={
        ext: pdf.per_page(w) for ext, w in images.WRITERS.items() if ext != ".pdf"
    },
)

_register_family(
    "PDF",
    readers={".pdf": pdf.read_text},
    writers={".txt": pdf.write_txt},
)


def supported_formats() -> list[dict]:
    return FAMILIES


def targets_for(src: Path) -> list[str]:
    """В какие форматы можно конвертировать этот файл (для выпадающего списка в UI)."""
    ext = src.suffix.lower()
    return [dst for (s, dst) in CONVERTERS if s == ext]


def convert(src: Path, dst: Path, options: Options | None = None) -> list[Path]:
    """Конвертирует src в dst (формат по расширениям). Возвращает список созданных файлов."""
    options = options or {}
    key = (src.suffix.lower(), canon(dst.suffix.lower()))
    try:
        func = CONVERTERS[key]
    except KeyError:
        raise UnsupportedConversion(f"{key[0]} -> {key[1]} не поддерживается") from None

    if not src.exists():
        raise ConversionError(f"Файл не найден: {src}")
    if not dst.parent.exists():
        raise ConversionError(f"Папка не существует: {dst.parent}")

    return func(src, dst, options)
