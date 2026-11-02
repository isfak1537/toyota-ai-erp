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
            only; both forecast the full 14 days from that origin. **AI-003 policy:** use the ML model for every series
            with at least 28 days of history, the baseline otherwise. The notebook also keeps the *old* rule (the lower
            holdout MAE per series) as a reference: because that choice is made on the same 14 noisy days it is scored on,
            a **nested estimate** repeats it on the *earlier* 14 days and scores it on the untouched holdout, which is the
            honest number and the reason the rule was replaced.
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
            names = {"baseline": "Moving average (baseline)", "policy": "AI-003 policy: ML from 28 days of history",
                     "ml": "ML (global model), same here", "per_series_selection": "Old rule: lower MAE per series (optimistic)",
                     "per_series_selection_nested": "Old rule, nested estimate (honest)", "seasonal_naive": "Seasonal naive (reference)"}
            overall = pd.DataFrame({names[k]: s.as_dict() for k, s in result.summaries.items()}).T
            overall = overall.rename(columns={"macro_mae": "MAE (mean of series)", "micro_mae": "MAE (pooled days)", "wape": "WAPE", "bias": "bias (forecast - actual)"}).drop(columns="series")
            print(f"holdout {result.holdout_start.date()} .. {result.holdout_end.date()}   |   {len(result.per_series)} series   |   ML available for {result.ml_series}   |   {result.model_samples:,} training samples")
            overall.round(3)
            """
        ),
        code(
            """
            s = result.summaries
            b, m, sel, nested = s["baseline"].macro_mae, s["policy"].macro_mae, s["per_series_selection"].macro_mae, s["per_series_selection_nested"].macro_mae
            print(f"The AI-003 policy (ML from 28 days of history) cuts the baseline MAE by {100 * (1 - m / b):.1f}% ({b:.3f} -> {m:.3f}).")
            print(f"The old rule's figure ({sel:.3f}) was optimistic: choosing the winner per series on the same 14 days flatters it.")
            print(f"Its nested estimate ({nested:.3f}) is the honest accuracy of that rule: {100 * (1 - nested / b):.1f}% better than the baseline, "
                  f"{'worse' if nested > m else 'better'} than the policy ({m:.3f}). That is why it was replaced.")
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
                             "ML": ev.mae_ml, "old rule": ev.selected_by_mae, "old rule, nested": ev.nested_by_mae, "sigma": ev.sigma,
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
            print(f"The policy uses ML for {result.selected_ml} series; the old rule would use it for {result.by_mae_ml}, and its nested (honest) version for {result.nested_by_mae_ml}.")
            agree = (per_series["old rule"] == per_series["old rule, nested"]).mean()
            print(f"The old rule and its nested version agree on only {100 * agree:.0f}% of series: with 14 noisy days, who 'wins' per series is unstable.")
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
            pick = {"Baseline": lambda e: e.baseline, "AI-003 policy (ML)": lambda e: e.selected_forecast, "Old rule": lambda e: e.by_mae_forecast,
                    "Old rule, nested": lambda e: e.nested_forecast}
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
            Right: the production forecast for the next 30 days with the policy model's ±1.65σ band.
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
                                   label=f"policy ({answer['selectedModel']}) ± 1.65σ")
                right.axvline(history.index[-1], color="#999999", ls="--", lw=1)
                right.set_title("Next 30 days (production forecast)")
                right.legend(loc="upper left", fontsize=8)
                for axis in (left, right):
                    axis.set_ylabel("units per day"); axis.tick_params(axis="x", rotation=30)
                fig.suptitle(title, fontweight="bold")
                plt.tight_layout()
                plt.show()
                print(f"policy uses {answer['selectedModel']} | baseline window {answer['baselineWindow']} | mean {answer['dailyMean']:.1f}/day | sigma {answer['sigma']:.2f} | "
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
              more reliable than any single series; the nested estimate is the figure to quote for any per-series selection rule.
            * **Demand is observed issues.** When stock hits zero, no issue is recorded, so true demand is under-stated
              (censoring). The synthetic data has very few stock-outs; real data may not.
            * **No outlier cleaning.** The eight injected anomalies stay in the training series; with ~2,700 issues
              their effect is small, but it is not zero.
            * **Sigma** is the RMSE of the policy model's 14 holdout residuals, floored at the Poisson spread. It is a
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

            Five transparent **rules** (R1-R5) and an **Isolation Forest risk score** with a weekly **review queue**
            score every stock transaction. Eight anomalies were injected into the synthetic ledger with ground-truth
            labels (`anomaly-labels.json`). The labels are used **only here**: they never reach training, rule thresholds,
            the eligibility rule or the queue size. This is the second pass; the first-pass numbers (commit `5b78db1`)
            are in `tests/fixtures/anomaly-baseline-v1.json` and are compared below.

            **Read this first.** The injected anomalies were designed with the same ideas the rules encode (outside
            business hours, a big negative adjustment, a duplicate), so the rules catch them *by construction*. The
            queue's result is the informative part, and it is shown without flattering it.
            """
        ),
        code(SETUP),
        code(
            """
            import json
            from app.anomaly.evaluate import _find, evaluate_anomaly_detection, load_labels, queue_metrics
            from app.anomaly.model import QUEUE_SIZE, fit_anomaly_model, score_ledger
            from app.data.sources import CsvSource

            source = CsvSource(FIXTURES)
            ledger, products, warehouses = source.ledger(), source.products(), source.warehouses()
            labels = load_labels(FIXTURES / "anomaly-labels.json")
            profiles = json.loads((FIXTURES / "scenarios.json").read_text())
            before = json.loads((FIXTURES / "anomaly-baseline-v1.json").read_text())

            model = fit_anomaly_model(ledger)
            scored = score_ledger(model, ledger)
            evaluation = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)
            related = {_find(ledger, products, warehouses, a["related"]) for a in labels["anomalies"] if a.get("related")}
            print(f"{len(scored):,} transactions scored, {int(scored.eligible.sum()):,} eligible for the queue | {int(scored.flagged.sum())} flagged "
                  f"(rules {int(scored.rule_flag.sum())}, queue {int(scored.model_flag.sum())}, both {int((scored.source == 'BOTH').sum())}) | {len(evaluation.labelled)} injected anomalies")
            """
        ),
        md(
            """
            ## 1. Before and after

            Changes in this pass, all decided before the results were seen: documented receipts and non-stock movements are
            not eligible for the model; rule R5 flags an identical movement within 10 minutes; the forest's score is a risk
            percentile and the top 10 eligible rows per local week form the review queue (no 0.5% cut).
            """
        ),
        code(
            """
            overall = evaluation.overall.set_index("detector")
            rows = []
            for name in ("rules", "model", "combined"):
                old, now = before["detectors"][name], overall.loc[name]
                rows.append({"detector": name, "caught before": old["caught"], "caught after": int(now.true_positives),
                             "false positives before": old["false_positives"], "false positives after": int(now.false_positives),
                             "precision before": old["precision"], "precision after": now.precision,
                             "recall before": old["recall"], "recall after": now.recall})
            pd.DataFrame(rows).set_index("detector").round(3)
            """
        ),
        code(
            """
            by_type = evaluation.by_type.set_index("anomaly_type")
            old = before["by_type_detected_rules_model_combined"]
            pd.DataFrame({
                "injected": by_type["injected"],
                "rules (before -> after)": [f"{old[t][0]} -> {int(by_type.loc[t, 'rules_detected'])}" for t in by_type.index],
                "model (before -> after)": [f"{old[t][1]} -> {int(by_type.loc[t, 'model_detected'])}" for t in by_type.index],
                "combined (before -> after)": [f"{old[t][2]} -> {int(by_type.loc[t, 'combined_detected'])}" for t in by_type.index],
            })
            """
        ),
        code(
            """
            r = evaluation.ranking
            print(f"Risk score, threshold-free, over {r['eligible_transactions']:,} eligible rows: ROC-AUC {r['roc_auc']:.3f} (before {before['ranking']['roc_auc']}); "
                  f"average precision {r['average_precision']:.3f} (before {before['ranking']['average_precision']}) vs {r['baseline_average_precision']:.4f} for a random ranking.")
            print("Labelled anomalies among the top K risk scores:", {f"top {k}": f"{v} of {r['labelled']}" for k, v in r["recall_at_k"].items()},
                  "| before:", before["ranking"]["recall_at_k"])
            print("The new figures are over eligible rows only; the old ones over all rows, so they are not like for like.")
            """
        ),
        md(
            """
            ## 2. The review queue: precision@N and recall@N

            N = 10 per local week was fixed before looking at results; 5 and 20 are a sensitivity check only. A queue row that is
            the original of a labelled duplicate counts as neither a hit nor a false alarm.
            """
        ),
        code(
            """
            queue = queue_metrics(scored, evaluation.labelled, related)
            queue.round(4)
            """
        ),
        code(
            """
            top = scored[scored["in_queue"]].sort_values("risk_score", ascending=False).head(5)
            top[["id", "type", "period", "risk_score", "queue_rank", "source", "top_features"]].assign(
                top_features=lambda d: d["top_features"].map(lambda f: "; ".join(x["feature"] for x in f) if isinstance(f, list) else f))
            """
        ),
        md("## 3. Every injected anomaly"),
        code(
            """
            evaluation.labelled[["label", "anomaly_type", "sku", "expected_detection", "rules", "model", "combined", "risk_score", "model_rank", "rule_codes"]].round(3)
            """
        ),
        code(
            """
            from app.anomaly.features import compute_features
            feats = compute_features(ledger, model.stats, 6)
            raw = pd.Series(model.raw_scores(feats), index=feats["id"])          # Isolation Forest score: higher = more anomalous
            labelled = evaluation.labelled.set_index("id")

            fig, ax = plt.subplots(figsize=(10, 4.4))
            ax.hist(raw[~raw.index.isin(labelled.index)], bins=70, color="#9aa5b1", label=f"all other transactions ({len(raw) - len(labelled):,})")
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
            ax.set_xscale("log"); ax.set_xlabel(f"rank of the risk score among {int(scored.eligible.sum()):,} eligible transactions (1 = riskiest)")
            ax.set_title("Risk rank of each injected anomaly (green = also caught by a rule)")
            plt.tight_layout(); plt.show()
            """
        ),
        md(
            """
            ### Why the model misses the off-hours events

            An Isolation Forest isolates points by random splits on features. Only a handful of transactions are outside
            business hours, so in most trees' random samples that feature is constant and cannot be split on. The rule
            covers them directly, which is the point of having both layers.
            """
        ),
        code(
            """
            off = (feats["off_hours_distance"] > 0).to_numpy()
            injected = feats["id"].isin(evaluation.labelled["id"]).to_numpy()
            print(f"{int(off.sum())} of {len(feats):,} transactions are outside business hours ({100 * off.mean():.2f}%); "
                  f"{int((off & injected).sum())} of them are injected anomalies.")
            saw = np.mean([off[idx].any() for idx in model.forest.estimators_samples_])
            print(f"Only {100 * saw:.0f}% of the {len(model.forest.estimators_samples_)} trees had an off-hours transaction in their sample; "
                  f"in the other {100 * (1 - saw):.0f}% that feature is constant and cannot isolate anything.")
            """
        ),
        md("## 4. False positives: what is flagged that is not labelled"),
        code(
            """
            from app.anomaly.evaluate import categorize_false_positives, is_data_artefact
            steered = {sku for sku, p in profiles["profiles"].items() if p in profiles["steeredProfiles"]}
            fp = categorize_false_positives(evaluation.false_positives, ledger, labels, steered)
            summary = fp.groupby(["source", "type", "likely_cause"]).size().rename("flags").reset_index().sort_values("flags", ascending=False)
            print(f"{len(fp)} false positives out of {int(scored.flagged.sum())} flags (before: {before['detectors']['combined']['false_positives']} of {before['flags']['total']}) "
                  f"-> precision {overall.loc['combined', 'precision']:.3f} (before {before['detectors']['combined']['precision']})")
            summary
            """
        ),
        code(
            """
            before_fp = pd.Series(before["false_positive_causes"], name="flags before").rename_axis("source, type and cause")
            natural = fp[~fp["likely_cause"].map(is_data_artefact)]
            print(f"After setting aside flags caused by how the synthetic data was built ({len(fp) - len(natural)}), {len(natural)} remain.")
            before_fp
            """
        ),
        md(
            """
            ## 5. What this does and does not show

            * **Rules catch what they were written for.** The injected anomalies match the rules, so the system did not
              discover them.
            * **The recall gain is mostly the eligibility rule.** Excluding receipts that carry a PO or goods-receipt link
              removes the large legitimate receipts and the opening stock from the model's competition. In a real plant it
              also makes the model blind to a wrong receipt that has a document.
            * **Precision fell and workload rose.** About 147 flags instead of 33, because a fixed-size weekly queue is
              always full and R5 also fires on natural repeats. Eight anomalies in 90 days cannot show what a real queue yields.
            * **Rule R2 also fires on ordinary tail events.** The 13 original rule false positives were examined by data
              fields: none is documented or a receipt, 12 are issues of 1.2 to 3.2 times the mean daily demand. A days-of-demand
              criterion would remove them but choosing it now would be tuning on seen labels; it is left to the owner.
            * **N = 10, the 10-minute R5 window and the exclusion were fixed up front;** N = 5 and 20 are sensitivity only.
            * **Eight labels** are far too few to tune anything. Real anomalies are rarer, subtler and unlabelled.
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
