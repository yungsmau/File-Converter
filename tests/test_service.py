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
    assert set(ops) == {"merge", "split", "compress", "shrink"}
    assert ops["merge"]["multi"] is True and ".pdf" in ops["split"]["accepts"]


def test_result_are_json_serialisable(make_png):
    import json

    json.dumps(service.describe_file(Path(make_png())))


def test_convert_with_custom_name_and_folder(make_png, tmp_path):
    out = tmp_path / "готово"
    out.mkdir()
    result = service.convert_file(str(make_png()), ".jpg", None, str(out), "Мой снимок")
    assert result["ok"] is True
    assert Path(result["outputs"][0]["path"]) == out / "Мой снимок.jpg"
    assert result["folder_name"] == "готово"


def test_custom_name_is_cleaned(make_png):
    # расширение, которое человек дописал сам, не удваивается, а запрещённые символы заменяются
    result = service.convert_file(str(make_png()), ".jpg", None, None, "a/b:c.JPG")
    assert Path(result["outputs"][0]["path"]).name == "a_b_c.jpg"
    # пустое имя означает "по умолчанию"
    result = service.convert_file(str(make_png("q.png")), ".jpg", None, None, "   ")
    assert Path(result["outputs"][0]["path"]).name == "q.jpg"


def test_missing_output_folder_is_an_error(make_png, tmp_path):
    result = service.convert_file(
        str(make_png()), ".jpg", None, str(tmp_path / "нет"), None
    )
    assert result["ok"] is False and "Папка не существует" in result["error"]


def test_tools_use_custom_name(make_pdf):
    a, b = make_pdf("a.pdf", 2), make_pdf("b.pdf", 3)
    merged = service.run_tool("merge", [str(a), str(b)], None, None, "Итог")
    assert Path(merged["outputs"][0]["path"]).name == "Итог.pdf"

    default = service.run_tool("compress", [str(a)])
    assert Path(default["outputs"][0]["path"]).name == "a_compressed.pdf"

    parts = service.run_tool("split", [str(b)], {"every": 2}, None, "Часть")
    assert [Path(o["path"]).name for o in parts["outputs"]] == [
        "Часть_pages-1-2.pdf",
        "Часть_page-3.pdf",
    ]

    preview = service.split_preview(str(b), {"every": 2}, "Часть")
    assert [x["name"] for x in preview["parts"]] == [
        "Часть_pages-1-2.pdf",
        "Часть_page-3.pdf",
    ]


def test_thumbnail_of_pdf_and_image(make_pdf, make_png):
    import base64
    import io

    from PIL import Image

    for path in (make_pdf("t.pdf", 3), make_png("t.png", size=(400, 300))):
        result = service.thumbnail(str(path), 0, 100)
        assert result["ok"] is True and result["data"].startswith(
            "data:image/jpeg;base64,"
        )
        img = Image.open(io.BytesIO(base64.b64decode(result["data"].split(",", 1)[1])))
        assert img.width <= 100


def test_thumbnail_errors_are_plain_dicts(make_pdf, tmp_path):
    assert service.thumbnail(str(make_pdf("t.pdf", 2)), 5)["ok"] is False
    broken = tmp_path / "x.pdf"
    broken.write_bytes(b"not a pdf")
    assert service.thumbnail(str(broken))["ok"] is False
    assert service.thumbnail(str(tmp_path / "нет.png"))["ok"] is False


def test_thumbnail_fits_tall_pages(tmp_path):
    import base64
    import io

    import pymupdf
    from PIL import Image

    path = tmp_path / "long.pdf"
    doc = pymupdf.open()
    doc.new_page(width=300, height=3000)
    doc.save(path)
    doc.close()

    data = service.thumbnail(str(path), 0, 100)["data"]
    img = Image.open(io.BytesIO(base64.b64decode(data.split(",", 1)[1])))
    assert img.width <= 100 and img.height <= 200


def test_shrink_through_service(tmp_path):
    from PIL import Image

    src = tmp_path / "photo.jpg"
    Image.effect_noise((1600, 1200), 60).convert("RGB").save(src, quality=95)
    result = service.run_tool("shrink", [str(src)], {"max_side": 800, "quality": 80})
    assert result["ok"] is True
    out = result["outputs"][0]
    assert (
        out["name"] == "photo_small.jpg"
        and out["dims"] == "800 × 600"
        and result["saved_percent"] > 0
    )

    named = service.run_tool("shrink", [str(src)], {"max_side": 400}, None, "мини")
    assert named["outputs"][0]["name"] == "мини.jpg"
    assert service.run_tool("shrink", [str(tmp_path / "a.pdf")])["ok"] is False
