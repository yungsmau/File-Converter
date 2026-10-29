from pathlib import Path

from core import service


def test_clean_options_drops_unkown_keys_and_forbids_overwrite():
    options = service.clean_options({"quality": 70, "overwrite": True, "rm -rf": "x"})
    assert options["quality"] == 70
    assert options["overwrite"] is False
    assert "rm -rf" not in options
    assert options["delimiter"] == ";"


def test_describe_pdf_and_image(make_pdf, make_png):
    pdf = service.describe_file(make_pdf("d.pdf", 4))
    assert (pdf["kind"], pdf["pages"]) == ("pdf", 4)
    assert ".txt" in pdf["targets"]

    img = service.describe_file(make_png("p.png", size=(400, 300)))
    assert (img["kind"], img["dims"]) == ("image", "400 × 300")


def test_desctibe_unreadable_files_does_not_raise(tmp_path):
    broken = tmp_path / "x.pdf"
    broken.write_bytes("мусор".encode())
    assert service.describe_file(broken)["note"] == "Не удалось прочитать файл"

    other = tmp_path / "note.docx"
    other.write_bytes(b"x")
    info = service.describe_file(other)
    assert info["kind"] == "other" and info["targets"] == []


def test_errors_become_plain_dicts(tmp_path):
    result = service.convert_file(str(tmp_path / "нет.png"), ".jpg")
    assert result["ok"] is False and "не найден" in result["error"]


def test_convert_and_compress_result(make_png, make_pdf):
    result = service.convert_file(str(make_png()), ".jpg")
    assert result["ok"] and result["outputs"][0]["name"] == "pic.jpg"

    result = service.run_tool(
        "compress", [str(make_pdf("c.pdf", 3))], {"level": "medium"}
    )
    assert result["ok"] and 0 <= result["saved_percent"] <= 100


def test_split_preview_service(make_pdf):
    path = str(make_pdf("r.pdf", 12))
    ok = service.split_preview(path, {"ranges": "1-3, 5"})
    assert [p["pages"] for p in ok["parts"]] == [3, 1]
    bad = service.split_preview(path, {"ranges": "3-1"})
    assert bad["ok"] is False


def test_operations_listing():
    ops = {o["id"]: o for o in service.operations()}
    assert set(ops) == {"merge", "split", "compress"}
    assert ops["merge"]["multi"] is True and ".pdf" in ops["split"]["accepts"]


def test_result_are_json_serialisable(make_png):
    import json

    json.dumps(service.describe_file(Path(make_png())))
