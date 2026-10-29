import openpyxl
import pymupdf
import pytest
from PIL import Image


@pytest.fixture
def make_pdf(tmp_path):
    """make_pdf('a.pdf', pages=5) -> путь к PDF, на каждой странице написан ее номер."""

    def make(name: str = "doc.pdf", pages: int = 3):
        path = tmp_path / name
        doc = pymupdf.open()
        for i in range(pages):
            doc.new_page().insert_text((72, 72), f"{path.stem} page {i + 1}")
        doc.save(path)
        doc.close()
        return path

    return make


@pytest.fixture
def make_png(tmp_path):
    def make(name: str = "pic.png", size=(120, 80), color="red", mode="RGB"):
        path = tmp_path / name
        Image.new(mode, size, color).save(path)
        return path

    return make


@pytest.fixture
def make_xlsx(tmp_path):
    """make_xlsx('t.xlsx', {'Лист1': [[...], ...], 'Лист2': [...]})"""

    def make(name: str, sheets: dict[str, list[list]]):
        path = tmp_path / name
        wb = openpyxl.Workbook()
        wb.remove(wb.active)
        for title, rows in sheets.items():
            ws = wb.create_sheet(title)
            for row in rows:
                ws.append(row)
        wb.save(path)
        return path

    return make
