import pytest

from core import service, settings, updates


@pytest.mark.parametrize(
    "text, expected",
    [
        ("v0.2.0", (0, 2, 0)),
        ("0.10.1", (0, 10, 1)),
        ("v1.0.0-beta", (1, 0, 0)),
        ("latest", None),
        (None, None),
        ("", None),
    ],
)
def test_parse_version(text, expected):
    assert updates.parse_version(text) == expected


@pytest.mark.parametrize(
    "new, old, expected",
    [
        ("v0.2.0", "0.1.0", True),
        ("0.10.0", "0.9.0", True),
        ("0.1.0", "0.1.0", False),
        ("0.1", "0.1.0", False),
        ("0.1.0", "0.2.0", False),
        ("v1", "0.9.9", True),
        ("мусор", "0.1.0", False),
    ],
)
def test_is_newer(new, old, expected):
    assert updates.is_newer(new, old) is expected


def reply(
    tag="v0.2.0", url="https://github.com/yungsmau/File-Converter/releases/tag/v0.2.0"
):
    return lambda _url: {"tag_name": tag, "html_url": url}


def test_check_finds_update():
    assert updates.check("0.1.0", reply()) == {
        "version": "0.2.0",
        "url": "https://github.com/yungsmau/File-Converter/releases/tag/v0.2.0",
    }


def test_check_no_update():
    assert updates.check("0.2.0", reply()) is None


def test_check_network_error_is_silent():
    def boom(_url):
        raise OSError("нет сети")

    assert updates.check("0.1.0", boom) is None


@pytest.mark.parametrize("data", [{}, {"tag_name": "nightly"}, [], "oops"])
def test_check_bad_answer(data):
    assert updates.check("0.1.0", lambda _u: data) is None


def test_check_foreign_url_replaced():
    result = updates.check("0.1.0", reply(url="https://evil.example/x"))
    assert result["url"] == updates.RELEASES_URL


def test_service_respects_toggle(monkeypatch):
    monkeypatch.setattr(
        updates, "check", lambda: {"version": "9.0.0", "url": updates.RELEASES_URL}
    )
    settings.save({"check_updates": False})
    assert service.check_updates()["update"] is None
    assert service.check_updates(force=True)["update"]["version"] == "9.0.0"


def test_service_skip(monkeypatch):
    monkeypatch.setattr(
        updates, "check", lambda: {"version": "9.0.0", "url": updates.RELEASES_URL}
    )
    assert service.check_updates()["update"] is not None
    service.skip_update("9.0.0")
    assert service.check_updates()["update"] is None
    monkeypatch.setattr(
        updates, "check", lambda: {"version": "9.1.0", "url": updates.RELEASES_URL}
    )
    assert service.check_updates()["update"]["version"] == "9.1.0"


def test_open_release_only_own_repo(monkeypatch):
    opened = []
    monkeypatch.setattr(service.webbrowser, "open", opened.append)
    assert service.open_release("https://evil.example")["ok"] is False
    assert service.open_release(updates.RELEASES_URL + "/tag/v1")["ok"] is True
    assert opened == [updates.RELEASES_URL + "/tag/v1"]


def test_settings_validation():
    assert (
        settings.save({"check_updates": 1})["check_updates"] is True
    )  # 1 не bool: отброшено, осталось умолчание
    assert settings.save({"check_updates": False})["check_updates"] is False
    assert settings.save({"skipped_version": "<script>"})["skipped_version"] == ""
    assert settings.save({"skipped_version": "0.3.0"})["skipped_version"] == "0.3.0"
    assert settings.save({"quality": True})["quality"] == 90
