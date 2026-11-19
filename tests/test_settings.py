import json

from core import service, settings


def test_defaults_when_no_file(isolated_settings):
    assert not isolated_settings.exists()
    assert settings.load() == settings.DEFAULTS


def test_save_and_load_roundtrip(isolated_settings):
    saved = settings.save({"delimiter": ",", "quality": 70, "dpi": 300})
    assert saved == {"delimiter": ",", "quality": 70, "dpi": 300}
    assert json.loads(isolated_settings.read_text(encoding="utf-8")) == saved
    settings._cache = None  # как после перезапуска приложения
    assert settings.load() == saved


def test_save_is_partial(isolated_settings):
    settings.save({"quality": 60})
    assert settings.save({"dpi": 72}) == {"delimiter": ";", "quality": 60, "dpi": 72}


def test_invalid_values_are_dropped(isolated_settings):
    saved = settings.save({"delimiter": "|", "quality": 5, "dpi": 123, "unknown": 1})
    assert saved == settings.DEFAULTS
    assert (
        settings.save({"quality": True})["quality"] == 90
    )  # True это 1 в Python, но качеством не является
    assert settings.save({"quality": "80"})["quality"] == 90
    assert settings.save({"quality": 100})["quality"] == 100  # границы допустимы
    assert settings.save({"quality": 30})["quality"] == 30


def test_broken_file_falls_back_to_defaults(isolated_settings):
    isolated_settings.parent.mkdir(parents=True, exist_ok=True)
    isolated_settings.write_text("{не json", encoding="utf-8")
    assert settings.load() == settings.DEFAULTS
    isolated_settings.write_text(
        json.dumps({"quality": 40, "dpi": 999, "x": 1}), encoding="utf-8"
    )
    settings._cache = None
    assert settings.load() == {
        **settings.DEFAULTS,
        "quality": 40,
    }  # годное берём, негодное нет


def test_reset(isolated_settings):
    settings.save({"quality": 50, "delimiter": "\t"})
    assert settings.reset() == settings.DEFAULTS


def test_service_api_and_clean_options(isolated_settings):
    reply = service.save_settings({"delimiter": ",", "dpi": 200})
    assert reply["ok"] is True and reply["values"]["delimiter"] == ","
    assert reply["choices"]["dpi"] == [72, 100, 150, 200, 300] and reply["limits"][
        "quality"
    ] == [30, 100]
    options = service.clean_options({})
    assert options["delimiter"] == "," and options["dpi"] == 200
    assert (
        service.clean_options({"dpi": 72})["dpi"] == 72
    )  # явная опция сильнее сохранённой настройки
    assert service.get_settings()["values"]["dpi"] == 200
    assert service.reset_settings()["values"] == settings.DEFAULTS


def test_delimiter_setting_reaches_csv(make_xlsx, tmp_path):
    src = make_xlsx("t.xlsx", {"Лист1": [["a", "b"], [1, 2]]})
    service.save_settings({"delimiter": ","})
    result = service.convert_file(str(src), ".csv")
    assert result["ok"] is True
    text = (tmp_path / "t.csv").read_text(encoding="utf-8-sig")
    assert text.splitlines()[0] == "a,b"
