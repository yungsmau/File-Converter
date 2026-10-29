from typer.testing import CliRunner

from cli import app

runner = CliRunner()


def test_convert_command(tmp_path, make_png):
    src = make_png()
    result = runner.invoke(app, ["convert", str(src), str(tmp_path / "out.jpg")])
    assert result.exit_code == 0
    assert (tmp_path / "out.jpg").exists()


def test_errors_exit_with_code_1(tmp_path, make_png):
    result = runner.invoke(app, ["convert", str(make_png()), str(tmp_path / "out.csv")])
    assert result.exit_code == 1


def test_merge_split_compress(make_pdf):
    a, b = make_pdf("a.pdf", 2), make_pdf("b.pdf", 3)
    assert runner.invoke(app, ["merge", str(a), str(b)]).exit_code == 0
    assert runner.invoke(app, ["split", str(b), "-n", "1"]).exit_code == 0
    assert runner.invoke(app, ["compress", str(a), "-l", "low"]).exit_code == 0
