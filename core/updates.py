"""Проверка обновлений: спрашивает GitHub, не вышла ли версия новее установленной.

Любая неудача (нет сети, GitHub не отвечает, странный ответ) означает "обновлений нет": приложение работает как обычно.
"""

import json
import re
import urllib.request

from core import __version__

REPO = "yungsmau/File-Converter"
RELEASES_URL = f"https://github.com/{REPO}/releases"
API_URL = f"https://api.github.com/repos/{REPO}/releases/latest"
TIMEOUT = 5  # секунд: проверка идёт в фоне, но висеть вечно не должна


def parse_version(text) -> tuple[int, ...] | None:
    """'v0.10.2' -> (0, 10, 2). Хвост вроде '-beta' отбрасывается. Если версии в тексте нет, вернёт None."""
    match = re.match(r"^\s*v?(\d+(?:\.\d+)*)", text if isinstance(text, str) else "")
    return tuple(int(part) for part in match.group(1).split(".")) if match else None


def is_newer(candidate, current) -> bool:
    """Сравнение по числам, а не по строкам: '0.10.0' новее '0.9.0', хотя как строка она меньше."""
    new, old = parse_version(candidate), parse_version(current)
    if new is None or old is None:
        return False
    size = max(len(new), len(old))
    pad = lambda v: v + (0,) * (size - len(v))  # noqa: E731  (0.1 и 0.1.0 одно и то же)
    return pad(new) > pad(old)


def _fetch(url: str) -> dict:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "FileConverter-update-check",
        },
    )
    with urllib.request.urlopen(
        request, timeout=TIMEOUT
    ) as response:  # noqa: S310 (адрес задан константой выше)
        return json.loads(response.read().decode("utf-8"))


def check(current: str = __version__, fetch=_fetch) -> dict | None:
    """{'version': '0.2.0', 'url': '...'} если на GitHub есть версия новее current, иначе None."""
    try:
        data = fetch(API_URL)
        tag = data["tag_name"]
        url = data.get("html_url") or RELEASES_URL
    except (
        Exception
    ):  # noqa: BLE001  сеть, JSON, нет нужного поля: всё это "обновлений нет"
        return None
    version = parse_version(tag)
    if version is None or not is_newer(tag, current):
        return None
    if not str(url).startswith(
        f"https://github.com/{REPO}/"
    ):  # ссылку из ответа открываем только если она ведёт в наш репозиторий
        url = RELEASES_URL
    return {"version": ".".join(map(str, version)), "url": url}
