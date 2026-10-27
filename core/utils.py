import re
from pathlib import Path

_BAD_FILENAME_CHARS = re.compile(r'[\\/:*?"<>|\[\]\x00-\x1f]')


def safe_name(name: str, fallback: str = "sheet") -> str:
    """Делаем из произвольной строки (например, названия листа) доступное имя файла."""
    cleaned = _BAD_FILENAME_CHARS.sub("_", name).strip(" .")
    return cleaned or fallback


def resolve_output(path: Path, overwrite: bool = False) -> Path:
    if overwrite or not path.exists():
        return path

    n = 1
    while True:
        candidate = path.with_name(f"{path.stem} ({n}){path.suffix}")
        if not candidate.exists():
            return candidate
        n += 1


def format_size(num_bytes: int) -> str:
    """3251200 -> '3,1 MБ'. Для показа в интерфейсе."""
    if num_bytes < 1024:
        return f"{num_bytes} Б"
    value = num_bytes / 1024
    for unit in ("КБ", "МБ", "ГБ"):
        if value < 1024 or unit == "ГБ":
            break
        value /= 1024
    text = f"{value:.1f}" if value < 10 else f"{value:.0f}"
    return f"{text.replace(".", ",")} {unit}"
