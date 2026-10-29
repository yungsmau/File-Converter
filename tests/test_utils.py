from core.utils import format_size, resolve_output, safe_name


def test_format_size():
    assert format_size(340) == "340 Б"
    assert format_size(2048) == "2,0 КБ"
    assert format_size(3_251_200) == "3,1 МБ"
    assert format_size(5_400_400) == "5,2 МБ"
    assert format_size(250 * 1024) == "250 КБ"


def test_safe_name_removes_forbidden_characters():
    assert safe_name("План/Факт: 2026?") == "План_Факт_ 2026_"
    assert safe_name("...") == "sheet"


def test_resolve_output_adds_suffix(tmp_path):
    target = tmp_path / "a.csv"
    assert resolve_output(target) == target
    target.write_text("x")
    assert resolve_output(target) == tmp_path / "a (1).csv"
    (tmp_path / "a (1).csv").write_text("x")
    assert resolve_output(target) == tmp_path / "a (2).csv"
    assert resolve_output(target, overwrite=True) == target
