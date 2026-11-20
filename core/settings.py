"""Настройки пользователя: то, что он выбрал в панели настроек.

Лежат в JSON-файле в папке конфигурации ОС и действуют на все следующие конвертации.
Окно может записать только известные ключи и допустимые значения: всё остальное отбрасывается.
"""

import json
import os
import re
import sys
import threading
from pathlib import Path

APP_DIR = "FileConverter"

DEFAULTS = {
    "delimiter": ";",  # русский Excel открывает CSV только с точкой с запятой
    "quality": 90,  # JPG и WebP
    "dpi": 150,  # PDF -> картинка
    "check_updates": True,  # спрашивать GitHub о новой версии при запуске
    "skipped_version": "",  # версия, про которую нажали "Позже": её баннер больше не показываем
}
CHOICES = {"delimiter": (";", ",", "\t"), "dpi": (72, 100, 150, 200, 300)}
LIMITS = {"quality": (30, 100)}
CONVERSION_KEYS = (
    "delimiter",
    "quality",
    "dpi",
)  # эти настройки влияют на конвертацию, остальные касаются самого приложения

_VERSION = re.compile(r"^\d+(\.\d+){0,3}$")


def config_path() -> Path:
    if sys.platform == "darwin":
        base = Path.home() / "Library" / "Application Support"
    elif sys.platform.startswith("win"):
        base = Path(os.environ.get("APPDATA") or Path.home() / "AppData" / "Roaming")
    else:
        base = Path(os.environ.get("XDG_CONFIG_HOME") or Path.home() / ".config")
    return base / APP_DIR / "settings.json"


def _is_valid(key: str, value) -> bool:
    if key == "check_updates":
        return isinstance(value, bool)
    if isinstance(value, bool):  # True == 1 в Python, но качеством это быть не должно
        return False
    if key == "skipped_version":
        return isinstance(value, str) and (value == "" or bool(_VERSION.match(value)))
    if key in CHOICES:
        return value in CHOICES[key]
    if key in LIMITS:
        low, high = LIMITS[key]
        return isinstance(value, int) and low <= value <= high
    return False


def _clean(raw) -> dict:
    """Оставляет только известные ключи с допустимыми значениями."""
    if not isinstance(raw, dict):
        return {}
    return {k: v for k, v in raw.items() if k in DEFAULTS and _is_valid(k, v)}


_lock = threading.Lock()
_cache: dict | None = (
    None  # читаем файл один раз: настройки нужны при каждой конвертации
)


def load() -> dict:
    """Текущие настройки: значения по умолчанию, поверх них то, что сохранено. Битый или отсутствующий файл не помеха."""
    global _cache
    with _lock:
        if _cache is None:
            try:
                raw = json.loads(config_path().read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raw = {}
            _cache = {**DEFAULTS, **_clean(raw)}
        return dict(_cache)


def save(values: dict) -> dict:
    """Записывает переданные настройки (недопустимые молча отбрасываются) и возвращает полный набор."""
    global _cache
    current = load()
    current.update(_clean(values))
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(
        ".tmp"
    )  # пишем во временный файл и подменяем: при сбое не останется половины файла
    tmp.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    with _lock:
        _cache = dict(current)
    return dict(current)


def reset() -> dict:
    return save(DEFAULTS)
