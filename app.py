import json
import sys
from pathlib import Path

import webview
from webview.dom import DOMEventHandler

from core import service

BASE_DIR = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
UI_DIR = BASE_DIR / "ui"


class Api:
    """Методы без подчеркивания видны из JS: window.pywebview.api.<имя>(). Вся логика живет в core.service."""

    def formats(self):
        return service.supported_formats()

    def operations(self):
        return service.operations()

    def pick_files(self, accept=None, multiple=False):
        window = webview.windows[0]
        result = window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=bool(multiple),
            file_types=service.dialog_filters(accept),
        )
        return [service.describe_file(Path(p)) for p in (result or [])]

    def convert(self, src, target_ext, options=None):
        return service.convert_file(src, target_ext, options)

    def run_tool(self, op_id, paths, options=None):
        return service.run_tool(op_id, paths, options)

    def split_preview(self, path, options=None):
        return service.split_preview(path, options)

    def reveal(self, path):
        service.reveal_in_folder(path)


def on_drop(event):
    files = event["dataTransfer"]["files"]
    paths = [Path(f["pywebviewFullPath"]) for f in files if f.get("pywebviewFullPath")]
    paths = [p for p in paths if p.is_file()]  # папки и недоступные файлы пропускаем
    if not paths:
        return
    window = webview.windows[0]
    # режим (конвертация или PDF) знает только страница, поэтому отдаем ей все файлы, а она решает, что с ними делать
    window.evaluate_js(
        f"onFilesDropped({json.dumps([service.describe_file(p) for p in paths])})"
    )


def bind_events(window):
    window.dom.document.events.dragover += DOMEventHandler(lambda e: None, True, True)
    window.dom.document.events.drop += DOMEventHandler(on_drop, True, True)


if __name__ == "__main__":
    window = webview.create_window(
        "Конвертер",
        str(UI_DIR / "index.html"),
        js_api=Api(),
        width=640,
        height=560,
        min_size=(560, 500),
    )
    webview.start(bind_events, window)
