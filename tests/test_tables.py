import csv

import openpyxl
import pytest

from core.errors import ConversionError
from core.registry import convert


def read_csv(path, delimiter=","):
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.reader(f, delimiter=delimiter))


def test_xlsx_to_csv(tmp_path, make_xlsx):
    src = make_xlsx(
        "t.xlsx", {"Лист1": [["имя", "сумма"], ["Аня", 10], ["Борис", 2.5]]}
    )
    [out] = convert(src, tmp_path / "t.csv", {"delimiter": ","})
    assert read_csv(out) == [["имя", "сумма"], ["Аня", "10"], ["Борис", "2.5"]]


def test_semicolon_means_decimal_comma(tmp_path, make_xlsx):
    src = make_xlsx("t.xlsx", {"Лист1": [["x"], [1.5]]})
    [out] = convert(src, tmp_path / "t.csv", {"delimiter": ";"})
    assert read_csv(out, ";")[1] == ["1,5"]


def test_several_sheets_become_several_files(tmp_path, make_xlsx):
    src = make_xlsx("t.xlsx", {"Продажи": [["а"], [1]], "Итоги": [["b"], [2]]})
    outs = convert(src, tmp_path / "t.csv", {})
    assert sorted(p.name for p in outs) == ["t_Итоги.csv", "t_Продажи.csv"]


def test_csv_to_xlsx_infers_numbers_and_keeps_leading_zeros(tmp_path):
    src = tmp_path / "in.csv"
    src.write_text("код;сумма\n007;1,5\n123;2\n", encoding="utf-8-sig")
    [out] = convert(src, tmp_path / "out.xlsx", {})
    ws = openpyxl.load_workbook(out).active
    assert ws["A2"].value == "007"
    assert ws["B2"].value == 1.5
    assert ws["A3"].value == 123


def test_csv_in_cp1251_is_read(tmp_path):
    src = tmp_path / "old.csv"
    src.write_text("город;население\Москва;13\n", encoding="cp1251")
    [out] = convert(src, tmp_path / "new.tsv", {})
    assert "Москва" in out.read_text(encoding="utf-8-sig")


def test_formulas_stay_text(tmp_path):
    src = tmp_path / "f.csv"
    src.write_text("a\n=1+1\n", encoding="utf-8")
    [out] = convert(src, tmp_path / "f.xlsx", {})
    cell = openpyxl.load_workbook(out).active["A2"]
    assert cell.data_type == "s"


def test_existing_file_is_not_overwritten(tmp_path, make_xlsx):
    src = make_xlsx("t.xlsx", {"Лист1": [["a"], [1]]})
    (tmp_path / "t.csv").write_text("не трогать", encoding="utf-8")
    [out] = convert(src, tmp_path / "t.csv", {})
    assert out.name == "t (1).csv"
    assert (tmp_path / "t.csv").read_text(encoding="utf-8") == "не трогать"


def test_missing_file_gives_readable_error(tmp_path):
    with pytest.raises(ConversionError, match="не найден"):
        convert(tmp_path / "нет.xlsx", tmp_path / "нет.csv", {})


# ---------- JSON ----------


def read_json(path):
    import json

    return json.loads(path.read_text(encoding="utf-8"))


def test_csv_to_json_infers_types(tmp_path):
    src = tmp_path / "in.csv"
    src.write_text("код;сумма;город\n007;1,5;Москва\n123;2;\n", encoding="utf-8-sig")
    [out] = convert(src, tmp_path / "out.json", {})
    assert read_json(out) == [
        {
            "код": "007",
            "сумма": 1.5,
            "город": "Москва",
        },  # 007 остаётся текстом, 1,5 становится числом
        {"код": 123, "сумма": 2, "город": None},  # пустая клетка -> null
    ]


def test_xlsx_to_json_dates_and_headers(tmp_path, make_xlsx):
    from datetime import date, datetime

    src = make_xlsx(
        "t.xlsx",
        {
            "Лист1": [
                ["имя", None, "имя"],
                ["Аня", date(2026, 1, 5), datetime(2026, 1, 5, 13, 30)],
            ]
        },
    )
    [out] = convert(src, tmp_path / "t.json", {})
    assert read_json(out) == [
        {"имя": "Аня", "column_2": "2026-01-05", "имя_2": "2026-01-05 13:30:00"}
    ]


def test_several_sheets_become_several_json_files(tmp_path, make_xlsx):
    src = make_xlsx("t.xlsx", {"Продажи": [["a"], [1]], "Итоги": [["b"], [2]]})
    outs = convert(src, tmp_path / "t.json", {})
    assert sorted(p.name for p in outs) == ["t_Итоги.json", "t_Продажи.json"]


def test_json_to_csv_and_xlsx(tmp_path):
    src = tmp_path / "d.json"
    src.write_text('[{"a": 1, "b": "x"}, {"a": 2, "c": true}]', encoding="utf-8")
    [csv_out] = convert(src, tmp_path / "d.csv", {"delimiter": ","})
    # поля берутся из всех объектов в порядке первого появления
    assert read_csv(csv_out) == [["a", "b", "c"], ["1", "x", ""], ["2", "", "TRUE"]]
    [xlsx_out] = convert(src, tmp_path / "d.xlsx", {})
    ws = openpyxl.load_workbook(xlsx_out).active
    assert [c.value for c in ws[1]] == ["a", "b", "c"] and ws["C3"].value is True


def test_json_nested_values_become_text(tmp_path):
    src = tmp_path / "n.json"
    src.write_text(
        '[{"id": 1, "tags": ["a", "б"], "meta": {"k": 1}}]', encoding="utf-8"
    )
    [out] = convert(src, tmp_path / "n.csv", {"delimiter": ","})
    assert read_csv(out)[1] == ["1", '["a", "б"]', '{"k": 1}']


def test_json_object_with_lists_becomes_sheets(tmp_path):
    src = tmp_path / "multi.json"
    src.write_text('{"users": [{"n": 1}], "orders": [{"m": 2}]}', encoding="utf-8")
    outs = convert(src, tmp_path / "multi.xlsx", {})
    wb = openpyxl.load_workbook(outs[0])
    assert wb.sheetnames == ["users", "orders"]


def test_json_errors_are_readable(tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{не json", encoding="utf-8")
    with pytest.raises(ConversionError, match="не похож на JSON"):
        convert(bad, tmp_path / "x.csv", {})
    scalar = tmp_path / "scalar.json"
    scalar.write_text("42", encoding="utf-8")
    with pytest.raises(ConversionError, match="Ожидается JSON-массив"):
        convert(scalar, tmp_path / "x.csv", {})
