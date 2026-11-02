import json
import subprocess
import sys
from pathlib import Path

import nbformat
import pytest

ROOT = Path(__file__).parent.parent
NOTEBOOKS = {"01_forecast_eval.ipynb": 3, "02_anomaly_eval.ipynb": 2}  # file -> number of charts


def outputs(notebook):
    return [(i, o) for i, c in enumerate(notebook.cells) if c.cell_type == "code" for o in c.get("outputs", [])]


@pytest.mark.parametrize("name, charts", NOTEBOOKS.items())
def test_the_committed_notebooks_were_executed_cleanly_with_their_charts(name, charts):
    path = ROOT / "notebooks" / name
    notebook = nbformat.read(path, as_version=4)
    produced = outputs(notebook)

    assert not [o for _, o in produced if o.output_type == "error"]
    assert sum(1 for _, o in produced if "image/png" in o.get("data", {})) == charts
    assert all(c.execution_count for c in notebook.cells if c.cell_type == "code")
    assert path.stat().st_size < 1_000_000  # a few hundred KB, not megabytes of git history
    assert not any("execution" in c.get("metadata", {}) for c in notebook.cells)  # volatile timestamps stripped


@pytest.mark.parametrize("name", NOTEBOOKS)
def test_the_notebooks_say_the_data_is_synthetic(name):
    notebook = nbformat.read(ROOT / "notebooks" / name, as_version=4)
    first = notebook.cells[0]

    assert first.cell_type == "markdown" and "synthetic" in first.source.lower()


def test_the_forecast_notebook_shows_both_demo_products():
    notebook = nbformat.read(ROOT / "notebooks" / "01_forecast_eval.ipynb", as_version=4)
    text = "\n".join(c.source for c in notebook.cells)

    assert "TREND_FAST: Cabin Air Filter (SYN-ENG-003)" in text and "OVERSTOCKED: Timing Belt Kit (SYN-ENG-005)" in text


def test_the_report_is_exactly_what_the_script_generates_from_the_current_code():
    sys.path.insert(0, str(ROOT / "scripts"))
    import build_report

    assert (ROOT / "REPORT.md").read_text() == build_report.build()


def test_the_report_states_the_unflattering_results():
    text = (ROOT / "REPORT.md").read_text()

    assert "Precision and recall at N per week" in text and "chosen up front" in text and "sensitivity only" in text
    assert "Most of the recall gain comes from excluding document-linked receipts" in text  # the caveat, not just the headline
    assert "| Combined | 6 / 8 | 8 / 8 |" in text and "precision 0.05 is acceptable" in text
    assert "nested" in text and "synthetic" in text.lower()
    assert "What not to conclude" in text


@pytest.mark.slow
def test_re_executing_the_notebooks_reproduces_the_committed_text_outputs(tmp_path):
    subprocess.run([sys.executable, "scripts/build_notebooks.py", str(tmp_path)], cwd=ROOT, check=True, capture_output=True)

    def text(path):
        notebook = nbformat.read(path, as_version=4)

        return [
            (i, o.get("text") or o.get("data", {}).get("text/plain"))
            for i, o in outputs(notebook)
            if o.output_type == "stream" or (o.output_type != "error" and "image/png" not in o.get("data", {}))
        ]

    for name in NOTEBOOKS:
        assert text(tmp_path / name) == text(ROOT / "notebooks" / name), name


def test_the_recorded_before_numbers_are_internally_consistent():
    before = json.loads((ROOT / "tests" / "fixtures" / "anomaly-baseline-v1.json").read_text())
    d = before["detectors"]

    for detector in d.values():
        assert detector["caught"] + detector["missed"] == before["labelled"]
        assert detector["recall"] == pytest.approx(detector["caught"] / before["labelled"], abs=0.005)

    assert d["rules"]["false_positives"] + d["model"]["false_positives"] == d["combined"]["false_positives"]
    assert sum(before["false_positive_causes"].values()) == d["combined"]["false_positives"]
    assert before["flags"]["rules"] + before["flags"]["model"] >= before["flags"]["total"]
