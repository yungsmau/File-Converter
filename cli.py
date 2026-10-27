from pathlib import Path
from typing import Callable, Optional

import typer

from core.errors import ConversionError
from core.pdf_tools import COMPRESS_LEVELS, run_operation
from core.registry import convert

app = typer.Typer(help="Локальный конвертер файлов.", no_args_is_help=True)


def _report(action: Callable[[], list[Path]]) -> None:
    """Общая обработка: запускает действие, печатает результат или понятную ошибку."""
    try:
        outputs = action()
    except ConversionError as e:
        typer.secho(str(e), fg=typer.colors.RED, err=True)
        raise typer.Exit(code=1) from None
    for path in outputs:
        typer.secho(f"Готово: {path}", fg=typer.colors.GREEN)


@app.command("convert")
def convert_cmd(
    src: Path = typer.Argument(..., help="Исходный файл", exists=True, dir_okay=False),
    dst: Path = typer.Argument(..., help="Куда сохранить (формат по расширению)"),
    delimiter: str = typer.Option(
        ",",
        "--delimiter",
        "-d",
        help="Разделитель для CSV, например ';' для русского Excel",
    ),
    overwrite: bool = typer.Option(
        False, "--overwrite", help="Перезаписывать существующие файлы"
    ),
    quality: int = typer.Option(
        90, "--quality", "-q", min=1, max=100, help="Качество для JPEG/WebP"
    ),
    dpi: int = typer.Option(
        150, "--dpi", min=36, max=600, help="Разрешение для PDF <-> картинки"
    ),
    background: str = typer.Option(
        "white",
        "--background",
        help="Фон вместо прозрачности (JPEG/BMP), например '#fff'",
    ),
):
    """Конвертировать файл. Пример: convert data.xlsx data.csv -d ';'"""
    if len(delimiter) != 1:
        typer.secho(
            "Разделитель должен быть одним символом", fg=typer.colors.RED, err=True
        )
        raise typer.Exit(code=2)

    options = {
        "delimiter": delimiter,
        "overwrite": overwrite,
        "quality": quality,
        "background": background,
        "dpi": dpi,
    }
    _report(lambda: convert(src, dst, options))


@app.command("merge")
def merge_cmd(
    sources: list[Path] = typer.Argument(
        ..., help="PDF и картинки в нужном порядке", exists=True, dir_okay=False
    ),
    output: Optional[Path] = typer.Option(
        None, "--output", "-o", help="Имя результата (по умолчанию <первый>_merged.pdf)"
    ),
    overwrite: bool = typer.Option(
        False, "--overwrite", help="Перезаписывать существующие файлы"
    ),
):
    """Объединить PDF (и картинки) в один. Пример: merge a.pdf b.pdf scan.jpg -o all.pdf"""
    _report(lambda: run_operation("merge", sources, {"overwrite": overwrite}, output))


@app.command("split")
def split_cmd(
    src: Path = typer.Argument(..., help="PDF-файл", exists=True, dir_okay=False),
    ranges: Optional[str] = typer.Option(
        None, "--ranges", "-r", help="Диапазоны: '1-3,5,7-' (файл на каждый)"
    ),
    every: int = typer.Option(
        1, "--every", "-n", min=1, help="Или по сколько страниц в одной части"
    ),
    overwrite: bool = typer.Option(
        False, "--overwrite", help="Перезаписывать существующие файлы"
    ),
):
    """Разделить PDF. По умолчанию каждая страница отдельно. Пример: split doc.pdf -r '1-3,5'"""
    _report(
        lambda: run_operation(
            "split", [src], {"ranges": ranges, "every": every, "overwrite": overwrite}
        )
    )


@app.command("compress")
def compress_cmd(
    src: Path = typer.Argument(..., help="PDF-файл", exists=True, dir_okay=False),
    level: str = typer.Option(
        "medium", "--level", "-l", help=f"Уровень сжатия: {', '.join(COMPRESS_LEVELS)}"
    ),
    output: Optional[Path] = typer.Option(
        None,
        "--output",
        "-o",
        help="Имя результата (по умолчанию <имя>_compressed.pdf)",
    ),
    overwrite: bool = typer.Option(
        False, "--overwrite", help="Перезаписывать существующие файлы"
    ),
):
    """Уменьшить размер PDF. Пример: compress big.pdf -l high"""
    _report(
        lambda: run_operation(
            "compress", [src], {"level": level, "overwrite": overwrite}, output
        )
    )


if __name__ == "__main__":
    app()
