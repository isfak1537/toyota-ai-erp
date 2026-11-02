"""Builds and executes the two evaluation notebooks (charts for the M3 demo).

    .venv/bin/python scripts/build_notebooks.py [output_dir]

Cells are defined here, the notebooks are executed with nbclient and saved with
their outputs. Volatile execution metadata (timestamps) is stripped so a rerun
on the same data gives a clean diff.
"""

from __future__ import annotations

import sys
import textwrap
from pathlib import Path

import nbformat
from nbclient import NotebookClient
from nbformat.v4 import new_code_cell, new_markdown_cell, new_notebook

ROOT = Path(__file__).resolve().parent.parent


def md(text: str):
    return new_markdown_cell(textwrap.dedent(text).strip())


def code(text: str):
    return new_code_cell(textwrap.dedent(text).strip())


SETUP = """
%matplotlib inline
import sys, warnings
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

ROOT = Path.cwd().parent                      # ai-service/
sys.path.insert(0, str(ROOT))
warnings.filterwarnings("ignore")
pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 30)
plt.rcParams.update({"figure.dpi": 100, "axes.spines.top": False, "axes.spines.right": False, "axes.grid": True, "grid.alpha": 0.25})

ACTUAL, BASELINE, ML, SELECTED = "#444444", "#0072B2", "#D55E00", "#009E73"   # colour-blind safe
FIXTURES = ROOT / "tests" / "fixtures"
"""


def forecast_notebook():
    cells = [
        md(
            """
            # Demand forecast evaluation (AI-001..AI-003)

            Holdout results for the **moving-average baseline** and the **global gradient-boosting model**,
            plus the forecasts of the two demo products. Everything here is computed from the committed
            synthetic ledger (`tests/fixtures`), the same data the tests use, with fixed seeds, so a rerun
            gives the same numbers. **The data is synthetic**: results show that the pipeline works and how
            the two models compare on this data, not what accuracy a real plant would see.

            **Protocol.** The last 14 days of every series are held out. The baseline window (7 or 14 days) is
            chosen on the training days only; the ML model is trained on days up to the day before the holdout
            only; both forecast the full 14 days from that origin. Per series the model with the lower holdout
            MAE is selected (AI-003). Because that choice is made on the same 14 noisy days it is scored on, a
            **nested estimate** repeats the choice on the *earlier* 14 days and scores it on the untouched holdout.
            """
        ),
        code(SETUP),
        code(
            """
            import json
            from app.data.series import daily_demand, series_map
            from app.data.sources import CsvSource
            from app.forecasting.evaluate import evaluate_forecasting

            source = CsvSource(FIXTURES)
            products = source.products().set_index("id")["sku"]
            profiles = json.loads((FIXTURES / "scenarios.json").read_text())
            steered = {sku for sku, profile in profiles["profiles"].items() if profile in profiles["steeredProfiles"]}

            series = series_map(daily_demand(source.ledger(), tz_offset_hours=6))
            label = lambda key: f"{products[key[0]]} @ {'MAIN' if key[1] == 1 else 'DEPOT'}"
            lengths = pd.Series({k: len(v) for k, v in series.items()})
            print(f"{len(series)} series, {lengths.min()}-{lengths.max()} days each, ending {max(v.index[-1] for v in series.values()).date()}")
            print(f"average daily demand per series: {np.mean([v.mean() for v in series.values()]):.1f} units "
                  f"(range {min(v.mean() for v in series.values()):.1f} - {max(v.mean() for v in series.values()):.1f})")
            """
        ),
        md("## 1. Overall holdout accuracy"),
        code(
            """
            result = evaluate_forecasting(series)
            names = {"baseline": "Moving average (baseline)", "ml": "ML (global model)", "selected": "Selected per series (AI-003)",
                     "nested_selected": "Selected, nested estimate (honest)", "seasonal_naive": "Seasonal naive (reference)"}
            overall = pd.DataFrame({names[k]: s.as_dict() for k, s in result.summaries.items()}).T
            overall = overall.rename(columns={"macro_mae": "MAE (mean of series)", "micro_mae": "MAE (pooled days)", "wape": "WAPE", "bias": "bias (forecast - actual)"}).drop(columns="series")
            print(f"holdout {result.holdout_start.date()} .. {result.holdout_end.date()}   |   {len(result.per_series)} series   |   ML available for {result.ml_series}   |   {result.model_samples:,} training samples")
            overall.round(3)
            """
        ),
        code(
            """
            s = result.summaries
            b, m, sel, nested = s["baseline"].macro_mae, s["ml"].macro_mae, s["selected"].macro_mae, s["nested_selected"].macro_mae
            print(f"ML cuts the baseline MAE by {100 * (1 - m / b):.1f}% ({b:.3f} -> {m:.3f}).")
            print(f"The AI-003 'selected' figure ({sel:.3f}) is optimistic: choosing the winner per series on the same 14 days flatters it.")
            print(f"The nested estimate ({nested:.3f}) is the honest accuracy of that selection policy: {100 * (1 - nested / b):.1f}% better than the baseline, "
                  f"{'worse' if nested > m else 'better'} than simply always using ML ({m:.3f}).")
            print(f"WAPE is still {100 * s['ml'].wape:.0f}% for ML: at 1-14 units a day, most of the error is Poisson noise no model can remove.")
            print(f"ML bias is {s['ml'].bias:+.3f} units/day ({100 * s['ml'].bias / np.mean([e.actual.mean() for e in result.per_series.values()]):+.1f}% of mean demand): it slightly under-forecasts.")
            """
        ),
        md("## 2. Series by series"),
        code(
            """
            rows = []
            for key, ev in result.per_series.items():
                rows.append({"series": label(key), "window": ev.baseline_window, "MA7": ev.mae_ma7, "MA14": ev.mae_ma14, "baseline": ev.mae_baseline,
                             "ML": ev.mae_ml, "selected": ev.selected, "nested": ev.nested_selected, "sigma": ev.sigma,
                             "steered": products[key[0]] in steered})
            per_series = pd.DataFrame(rows).sort_values("baseline", ascending=False).reset_index(drop=True)

            fig, ax = plt.subplots(figsize=(10, 6.5))
            y = np.arange(len(per_series))
            ax.barh(y + 0.2, per_series["baseline"], height=0.38, color=BASELINE, label="Baseline (moving average)")
            ax.barh(y - 0.2, per_series["ML"], height=0.38, color=ML, label="ML (global model)")
            ax.set_yticks(y, per_series["series"], fontsize=8)
            ax.invert_yaxis()
            ax.set_xlabel("MAE on the 14-day holdout (units per day, lower is better)")
            ax.set_title("Holdout MAE per series")
            ax.legend(loc="lower right")
            plt.tight_layout()
            plt.show()
            """
        ),
        code(
            """
            wins = (per_series["ML"] < per_series["baseline"]).sum()
            print(f"ML beats the baseline on the holdout in {wins} of {len(per_series)} series; the baseline wins or ties in {len(per_series) - wins}:")
            per_series[per_series["ML"] >= per_series["baseline"]][["series", "window", "baseline", "ML"]].round(2)
            """
        ),
        code(
            """
            print("Baseline window chosen on training days only:", per_series["window"].value_counts().sort_index().to_dict())
            print(f"Selection: AI-003 picks ML for {result.selected_ml} series; the nested (honest) policy picks ML for {result.nested_selected_ml}.")
            agree = (per_series["selected"] == per_series["nested"]).mean()
            print(f"The two selections agree on only {100 * agree:.0f}% of series: with 14 noisy days, who 'wins' per series is largely luck.")
            """
        ),
        md(
            """
            ### Sensitivity: the series the seed generator steered

            For the SEED-007 demo scenarios the generator *shapes the last 12 days of demand* of five products
            (four near their reorder point, one fast-growing) so they end at chosen stock levels. Those days are
            not natural demand, and they fall inside the holdout. The table repeats the comparison without them.
            """
        ),
        code(
            """
            from app.forecasting.metrics import summarise
            keep = {k: ev for k, ev in result.per_series.items() if products[k[0]] not in steered}
            pick = {"Baseline": lambda e: e.baseline, "ML": lambda e: e.ml_or_baseline, "Selected": lambda e: e.selected_forecast,
                    "Selected, nested": lambda e: e.nested_forecast}
            table = pd.DataFrame({
                name: {"all series": summarise({k: (e.actual, f(e)) for k, e in result.per_series.items()}).macro_mae,
                       f"without {len(result.per_series) - len(keep)} steered series": summarise({k: (e.actual, f(e)) for k, e in keep.items()}).macro_mae}
                for name, f in pick.items()}).T
            table.round(3)
            """
        ),
        md(
            """
            ## 3. Forecasts for the two demo products

            Left: the holdout check (a forecast made the day before the grey band, compared with what happened).
            Right: the production forecast for the next 30 days with the selected model's ±1.65σ band.
            **The Cabin Air Filter is one of the steered products**: the generator shaped its last 12 days of demand to
            land a demo stock level, so its holdout is synthetic demand shaping, not natural demand. The Timing Belt
            Kit is the over-stocked demo product: low, lumpy demand, where a flat average is hard to beat.
            """
        ),
        code(
            """
            import tempfile
            from app.forecasting.service import ForecastService
            from app.forecasting.training import train_forecasting
            from app.registry import ModelRegistry
            from app.forecasting.baseline import moving_average_forecast

            registry = ModelRegistry(tempfile.mkdtemp())
            outcome = train_forecasting(series, registry)
            service = ForecastService(source, registry, tz_offset_hours=6)
            sku_id = {v: k for k, v in products.items()}
            demo = {"TREND_FAST: Cabin Air Filter (SYN-ENG-003)": (sku_id["SYN-ENG-003"], 1),
                    "OVERSTOCKED: Timing Belt Kit (SYN-ENG-005)": (sku_id["SYN-ENG-005"], 1)}
            print("model version:", outcome.version)
            """
        ),
        code(
            """
            def show(title, key):
                ev = result.per_series[key]
                history = series[key]
                answer = service.forecast([key], 30)["results"][0]
                future = pd.DataFrame(answer["forecast"]); future["date"] = pd.to_datetime(future["date"])
                holdout_days = history.index[-14:]
                recent = history.iloc[-60:]

                fig, (left, right) = plt.subplots(1, 2, figsize=(13, 4.4), gridspec_kw={"width_ratios": [1, 1.25]}, sharey=True)
                left.plot(recent.index, recent.values, color=ACTUAL, lw=1.4, label="actual demand")
                left.plot(holdout_days, ev.baseline, color=BASELINE, lw=2, label=f"baseline (MA{ev.baseline_window}), MAE {ev.mae_baseline:.2f}")
                left.plot(holdout_days, ev.ml, color=ML, lw=2, label=f"ML, MAE {ev.mae_ml:.2f}")
                left.axvspan(holdout_days[0], holdout_days[-1], color="#999999", alpha=0.12)
                left.set_title("Holdout check: forecast from the day before the grey band")
                left.legend(loc="upper left", fontsize=8)

                right.plot(recent.index, recent.values, color=ACTUAL, lw=1.4, label="actual demand")
                right.plot(future["date"], future["baseline"], color=BASELINE, lw=2, label="baseline")
                right.plot(future["date"], future["ml"], color=ML, lw=2, label="ML")
                chosen = future["mean"].to_numpy()
                right.fill_between(future["date"], np.clip(chosen - 1.65 * answer["sigma"], 0, None), chosen + 1.65 * answer["sigma"], color=SELECTED, alpha=0.15,
                                   label=f"selected ({answer['selectedModel']}) ± 1.65σ")
                right.axvline(history.index[-1], color="#999999", ls="--", lw=1)
                right.set_title("Next 30 days (production forecast)")
                right.legend(loc="upper left", fontsize=8)
                for axis in (left, right):
                    axis.set_ylabel("units per day"); axis.tick_params(axis="x", rotation=30)
                fig.suptitle(title, fontweight="bold")
                plt.tight_layout()
                plt.show()
                print(f"selected {answer['selectedModel']} | baseline window {answer['baselineWindow']} | mean {answer['dailyMean']:.1f}/day | sigma {answer['sigma']:.2f} | "
                      f"holdout MAE baseline {answer['metrics']['maeBaseline']:.2f}, ML {answer['metrics']['maeMl']:.2f}")

            show(list(demo)[0], list(demo.values())[0])
            """
        ),
        code(
            """
            show(list(demo)[1], list(demo.values())[1])
            """
        ),
        md(
            """
            ## 4. What this does and does not show

            * **Synthetic data.** Demand is Poisson noise around a weekday pattern and a trend. The model finding
              that structure is expected; real demand has promotions, stock-outs, returns and shocks.
            * **One 14-day holdout.** Per-series MAEs rest on 14 noisy points. The comparison across all series is
              more reliable than any single series, and the nested estimate is the figure to quote for the selection policy.
            * **Demand is observed issues.** When stock hits zero, no issue is recorded, so true demand is under-stated
              (censoring). The synthetic data has very few stock-outs; real data may not.
            * **No outlier cleaning.** The eight injected anomalies stay in the training series; with ~2,700 issues
              their effect is small, but it is not zero.
            * **Sigma** is the RMSE of the selected model's 14 holdout residuals, floored at the Poisson spread. It is a
              rough, noisy estimate and feeds the safety stock (AI-004).
            """
        ),
    ]

    return new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}})


def anomaly_notebook():
    cells = [
        md(
            """
            # Anomaly detection evaluation (AI-008)

            Four transparent **rules** and an **Isolation Forest** score every stock transaction. Eight anomalies were
            injected into the synthetic ledger with ground-truth labels (`anomaly-labels.json`). The labels are used
            **only here**: they never reach training, rule thresholds or the contamination rate (fixed at 0.5%
            beforehand). Rules, model and the combination are reported separately.

            **Read this first.** The injected anomalies were designed with the same ideas the rules encode (outside
            business hours, a big negative adjustment), so the rules catch them *by construction*. The model's
            result is the informative part, and it is shown without flattering it.
            """
        ),
        code(SETUP),
        code(
            """
            import json
            from app.anomaly.evaluate import evaluate_anomaly_detection, load_labels
            from app.anomaly.model import fit_anomaly_model, score_ledger
            from app.data.sources import CsvSource

            source = CsvSource(FIXTURES)
            ledger, products, warehouses = source.ledger(), source.products(), source.warehouses()
            labels = load_labels(FIXTURES / "anomaly-labels.json")
            profiles = json.loads((FIXTURES / "scenarios.json").read_text())

            model = fit_anomaly_model(ledger)
            scored = score_ledger(model, ledger)
            evaluation = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)
            print(f"{len(scored):,} transactions scored | {int(scored.flagged.sum())} flagged "
                  f"(rules {int(scored.rule_flag.sum())}, model {int(scored.model_flag.sum())}, both {int((scored.source == 'BOTH').sum())}) | {len(evaluation.labelled)} injected anomalies")
            """
        ),
        md("## 1. Detection by anomaly type"),
        code(
            """
            by_type = evaluation.by_type.set_index("anomaly_type")
            table = pd.DataFrame({
                "injected": by_type["injected"],
                "rules": by_type["rules_detected"].astype(int).astype(str) + " / " + by_type["injected"].astype(str),
                "model": by_type["model_detected"].astype(int).astype(str) + " / " + by_type["injected"].astype(str),
                "combined": by_type["combined_detected"].astype(int).astype(str) + " / " + by_type["injected"].astype(str),
            })
            table.loc["ALL"] = [by_type["injected"].sum()] + [f"{int(by_type[c].sum())} / {int(by_type['injected'].sum())}" for c in ("rules_detected", "model_detected", "combined_detected")]
            table
            """
        ),
        code(
            """
            overall = evaluation.overall.set_index("detector")
            overall = overall[["true_positives", "missed", "false_positives", "precision", "recall"]]
            overall.round(3)
            """
        ),
        code(
            """
            r = evaluation.ranking
            print(f"Model score, threshold-free: ROC-AUC {r['roc_auc']:.3f}; average precision {r['average_precision']:.3f} "
                  f"vs {r['baseline_average_precision']:.4f} for a random ranking ({r['average_precision'] / r['baseline_average_precision']:.0f}x).")
            print("Labelled anomalies found among the model's top K:", {f"top {k}": f"{v} of {r['labelled']}" for k, v in r["recall_at_k"].items()})
            flags = scored[scored["model_flag"]]
            print(f"At the 0.5% operating point the model catches {int(evaluation.labelled['model'].sum())} of {len(evaluation.labelled)} injected anomalies; "
                  f"its {len(flags)} flags are all {', '.join(sorted(flags['type'].unique()))} rows (large goods receipts, the opening stock).")
            """
        ),
        md("## 2. Every injected anomaly"),
        code(
            """
            evaluation.labelled[["label", "anomaly_type", "sku", "expected_detection", "rules", "model", "combined", "model_score", "model_rank", "rule_codes"]].round(3)
            """
        ),
        code(
            """
            from app.anomaly.features import compute_features
            feats = compute_features(ledger, model.stats, 6)
            raw = pd.Series(model.raw_scores(feats), index=feats["id"])          # Isolation Forest score: higher = more anomalous
            threshold = np.quantile(model.train_scores, 1 - model.contamination)
            labelled = evaluation.labelled.set_index("id")

            fig, ax = plt.subplots(figsize=(10, 4.4))
            ax.hist(raw[~raw.index.isin(labelled.index)], bins=70, color="#9aa5b1", label=f"all other transactions ({len(raw) - len(labelled):,})")
            ax.axvline(threshold, color=ML, ls="--", lw=1.6, label="model flag threshold (top 0.5%)")
            for row_id, row in labelled.iterrows():
                ax.axvline(raw[row_id], ymax=0.55, color=SELECTED if row["rules"] else BASELINE, lw=2, alpha=0.9)
            ax.plot([], [], color=SELECTED, lw=2, label="injected anomaly, caught by a rule")
            ax.plot([], [], color=BASELINE, lw=2, label="injected anomaly, missed by every rule")
            ax.set_yscale("log"); ax.set_xlabel("Isolation Forest anomaly score (higher = more anomalous)"); ax.set_ylabel("transactions (log scale)")
            ax.set_title("Where the injected anomalies fall in the model's raw score distribution")
            ax.legend(fontsize=8, loc="upper right"); plt.tight_layout(); plt.show()
            """
        ),
        code(
            """
            fig, ax = plt.subplots(figsize=(8.5, 3.8))
            data = evaluation.labelled.sort_values("model_rank", ascending=False)
            colors = [SELECTED if r else BASELINE for r in data["rules"]]
            ax.barh(data["label"] + "  " + data["anomaly_type"].str.replace("_", " ").str.lower(), data["model_rank"], color=colors)
            ax.axvline(int(len(scored) * 0.005), color=ML, ls="--", label="model flags only ranks 1-%d" % int(len(scored) * 0.005))
            ax.set_xscale("log"); ax.set_xlabel(f"rank of the model score among {len(scored):,} transactions (1 = most anomalous)")
            ax.set_title("Model rank of each injected anomaly (green = also caught by a rule)")
            ax.legend(fontsize=8); plt.tight_layout(); plt.show()
            """
        ),
        md(
            """
            ## 2b. Why the model misses the off-hours events

            An Isolation Forest isolates points by random splits on features. In the training data only a handful of
            transactions are outside business hours, so in most trees' random samples that feature is constant and
            cannot be split on: such events are not isolated quickly and look ordinary. The rule covers them directly,
            which is the point of having both layers.
            """
        ),
        code(
            """
            off = (feats["off_hours_distance"] > 0).to_numpy()
            injected = feats["id"].isin(evaluation.labelled["id"]).to_numpy()
            print(f"{int(off.sum())} of {len(feats):,} transactions are outside business hours ({100 * off.mean():.2f}%); "
                  f"{int((off & injected).sum())} of them are injected anomalies.")

            # the hypothesis, checked: how many trees ever saw an off-hours row in their random sample?
            saw = np.mean([off[idx].any() for idx in model.forest.estimators_samples_])
            print(f"Only {100 * saw:.0f}% of the {len(model.forest.estimators_samples_)} trees had an off-hours transaction in their sample; "
                  f"in the other {100 * (1 - saw):.0f}% that feature is constant and cannot isolate anything.")
            """
        ),
        md("## 3. False positives: what the combined detector flags that is not labelled"),
        code(
            """
            from app.anomaly.evaluate import categorize_false_positives, is_data_artefact
            steered = {sku for sku, p in profiles["profiles"].items() if p in profiles["steeredProfiles"]}
            fp = categorize_false_positives(evaluation.false_positives, ledger, labels, steered)
            summary = fp.groupby(["source", "type", "likely_cause"]).size().rename("flags").reset_index().sort_values("flags", ascending=False)
            print(f"{len(fp)} false positives out of {int(scored.flagged.sum())} flags "
                  f"-> precision {evaluation.overall.set_index('detector').loc['combined', 'precision']:.2f}")
            summary
            """
        ),
        code(
            """
            natural = fp[~fp["likely_cause"].map(is_data_artefact)]
            print(f"Setting aside the flags caused by how the synthetic data was built ({len(fp) - len(natural)}), {len(natural)} flags remain:")
            natural["likely_cause"].value_counts()
            """
        ),
        md(
            """
            ## 4. What this does and does not show

            * **Rules catch what they were written for.** Off-hours events, large negative adjustments and large manual
              receipts are found because the injected anomalies match the rules, not because the system discovered anything.
            * **The model adds little at its operating point on this data.** It ranks the labelled rows well above chance
              (see ROC-AUC and average precision) but not into the top 0.5%, and its flags are dominated by large legitimate
              receipts. Duplicates, which were deliberately left to it, are missed.
            * **Rule R2 also fires on ordinary tail events.** Daily demand is Poisson-like, so now and then one issue holds a
              whole busy day's units; a robust z-score on such skewed counts is not conservative. Thresholds were fixed
              before looking at the labels and are not retuned here.
            * **Eight labels** are far too few to tune anything, and tuning on them would only overfit.
            * Real anomalies are rarer, subtler and unlabelled; precision on real data will differ.
            """
        ),
    ]

    return new_notebook(cells=cells, metadata={"kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"}})


def execute(notebook, path: Path):
    # always run from ai-service/notebooks (the cells locate the project from there), wherever the file is written
    client = NotebookClient(notebook, timeout=900, kernel_name="python3", resources={"metadata": {"path": str(ROOT / "notebooks")}})
    client.execute()

    for cell in notebook.cells:  # volatile timing metadata would change on every run
        cell.get("metadata", {}).pop("execution", None)

    path.write_text(nbformat.writes(notebook))


def main(output: Path) -> None:
    import matplotlib.pyplot  # noqa: F401  (builds the font cache here, so it never shows up in a notebook's output)

    output.mkdir(parents=True, exist_ok=True)

    for name, builder in (("01_forecast_eval.ipynb", forecast_notebook), ("02_anomaly_eval.ipynb", anomaly_notebook)):
        path = output / name
        print("executing", path, flush=True)
        execute(builder(), path)

        notebook = nbformat.read(path, as_version=4)
        errors = [o for c in notebook.cells if c.cell_type == "code" for o in c.outputs if o.output_type == "error"]
        images = sum(1 for c in notebook.cells if c.cell_type == "code" for o in c.get("outputs", []) if "image/png" in o.get("data", {}))
        print(f"  {path.stat().st_size / 1024:.0f} KB, {images} charts, {len(errors)} errors", flush=True)

        if errors:
            raise SystemExit(f"{name} has {len(errors)} error output(s)")


if __name__ == "__main__":
    main(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "notebooks")
