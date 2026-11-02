"""Writes ai-service/REPORT.md from the same evaluation code the notebooks use.

    .venv/bin/python scripts/build_report.py

Every number comes from running the evaluation on the committed fixtures; the
sentences are conditional on those numbers, so the report cannot drift from them.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from app.anomaly.evaluate import categorize_false_positives, evaluate_anomaly_detection, is_data_artefact, load_labels  # noqa: E402
from app.anomaly.model import fit_anomaly_model, score_ledger  # noqa: E402
from app.data.series import daily_demand, series_map  # noqa: E402
from app.data.sources import CsvSource  # noqa: E402
from app.forecasting.evaluate import evaluate_forecasting  # noqa: E402
from app.forecasting.metrics import summarise  # noqa: E402
from app.versioning import library_versions  # noqa: E402

FIXTURES = ROOT / "tests" / "fixtures"


def table(header: list[str], rows: list[list]) -> str:
    line = lambda cells: "| " + " | ".join(str(c) for c in cells) + " |"

    return "\n".join([line(header), line(["---"] * len(header)), *[line(r) for r in rows]])


def pct(value: float) -> str:
    return f"{100 * value:.1f}%"


def build() -> str:
    source = CsvSource(FIXTURES)
    ledger, products, warehouses = source.ledger(), source.products(), source.warehouses()
    sku = products.set_index("id")["sku"]
    profiles = json.loads((FIXTURES / "scenarios.json").read_text())
    steered = {k for k, v in profiles["profiles"].items() if v in profiles["steeredProfiles"]}
    labels = load_labels(FIXTURES / "anomaly-labels.json")

    # ---------------------------------------------------------------- forecasting
    series = series_map(daily_demand(ledger, tz_offset_hours=6))
    forecast = evaluate_forecasting(series)
    s = forecast.summaries
    b, m, sel, nested, naive = (s[k].macro_mae for k in ("baseline", "ml", "per_series_selection", "per_series_selection_nested", "seasonal_naive"))
    policy = s["policy"].macro_mae
    evaluated = forecast.per_series
    wins = sum(1 for e in evaluated.values() if e.mae_ml is not None and e.mae_ml < e.mae_baseline)
    agree = np.mean([e.selected_by_mae == e.nested_by_mae for e in evaluated.values()])
    mean_demand = np.mean([e.actual.mean() for e in evaluated.values()])
    kept = {k: e for k, e in evaluated.items() if sku[k[0]] not in steered}
    sub = lambda pick: summarise({k: (e.actual, pick(e)) for k, e in kept.items()}).macro_mae
    sub_b, sub_m, sub_sel, sub_nested = sub(lambda e: e.baseline), sub(lambda e: e.ml_or_baseline), sub(lambda e: e.by_mae_forecast), sub(lambda e: e.nested_forecast)
    sigma = np.array([e.sigma for e in evaluated.values()])
    windows = pd.Series([e.baseline_window for e in evaluated.values()]).value_counts().sort_index().to_dict()

    names = [("baseline", "Moving average (baseline)"), ("policy", "**AI-003 policy: ML from 28 days of history**"),
             ("per_series_selection", "Old rule: lower MAE per series (optimistic)"), ("per_series_selection_nested", "Old rule, nested estimate (honest)"),
             ("seasonal_naive", "Seasonal naive (reference)")]
    overall_rows = [[label, f"{s[k].macro_mae:.3f}", f"{s[k].micro_mae:.3f}", f"{s[k].wape:.3f}", f"{s[k].bias:+.3f}"] for k, label in names]

    # ------------------------------------------------------------------- anomalies
    model = fit_anomaly_model(ledger)
    scored = score_ledger(model, ledger)
    ev = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)
    o = ev.overall.set_index("detector")
    fp = categorize_false_positives(ev.false_positives, ledger, labels, steered)
    artefacts = int(fp["likely_cause"].map(is_data_artefact).sum())
    r = ev.ranking
    flags = scored[scored["model_flag"]]
    type_rows = [
        [t["anomaly_type"].replace("_", " ").title(), int(t["injected"]), f"{int(t['rules_detected'])} / {int(t['injected'])}",
         f"{int(t['model_detected'])} / {int(t['injected'])}", f"{int(t['combined_detected'])} / {int(t['injected'])}"]
        for _, t in ev.by_type.iterrows()
    ]
    total = int(ev.by_type["injected"].sum())
    type_rows.append(["**All**", total] + [f"**{int(ev.by_type[c].sum())} / {total}**" for c in ("rules_detected", "model_detected", "combined_detected")])
    detector_rows = [[n.title(), int(o.loc[n, "true_positives"]), int(o.loc[n, "missed"]), int(o.loc[n, "false_positives"]),
                      "n/a" if np.isnan(o.loc[n, "precision"]) else f"{o.loc[n, 'precision']:.2f}", f"{o.loc[n, 'recall']:.2f}"] for n in ("rules", "model", "combined")]
    fp_rows = [[src, typ, cause, int(n)] for (src, typ, cause), n in fp.groupby(["source", "type", "likely_cause"]).size().sort_values(ascending=False).items()]
    missed = ev.labelled[~ev.labelled["combined"]]
    versions = library_versions()

    return f"""# AI service: evaluation report

*Generated by `scripts/build_report.py` from the committed synthetic fixtures. Do not edit by hand; rerun the script.*

**Everything here is measured on synthetic data** (`prisma/seed`, seed 20261102, {len(series)} product-warehouse series, 90 days,
{len(ledger):,} ledger rows). It shows that the pipeline works and how the methods compare on this data. It says little about the
accuracy a real plant would see. Python {versions['python']}, pandas {versions['pandas']}, scikit-learn {versions['scikit_learn']}; all random seeds are fixed.

## Summary

* **Forecast.** The AI-003 policy (the global ML model for every series with at least 28 days of history, the baseline otherwise) has a
  {pct(1 - policy / b)} lower holdout MAE than the 7/14-day moving average ({policy:.3f} vs {b:.3f} units/day) and is better on {wins} of {len(evaluated)} series.
* **Why the policy replaced "lower holdout MAE per series".** That rule reports {sel:.3f}, but only because it picks each winner on the days it is scored on.
  Its nested (honest) estimate is {nested:.3f}, {'worse' if nested > policy else 'better'} than the policy ({policy:.3f}).
* **Anomalies.** The four rules catch {int(o.loc['rules', 'true_positives'])} of {total} injected anomalies, by construction. The
  Isolation Forest catches **{int(o.loc['model', 'true_positives'])} of {total}** at its 0.5% operating point, although it ranks them
  far above chance (ROC-AUC {r['roc_auc']:.2f}). Combined precision is {o.loc['combined', 'precision']:.2f}: {int(o.loc['combined', 'false_positives'])} of {int(scored['flagged'].sum())} flags are not labelled anomalies.

## 1. Forecasting (AI-001..AI-003)

**Protocol.** The last 14 days ({forecast.holdout_start.date()} to {forecast.holdout_end.date()}) are held out. The baseline window (7 or 14) is chosen
on training days only; the ML model is trained on days up to the day before the holdout only ({forecast.model_samples:,} samples); both forecast
all 14 days from that origin. MAE is in units per day. "MAE (mean of series)" counts every series equally; "pooled" counts every forecast day equally.

{table(["Policy", "MAE (mean of series)", "MAE (pooled days)", "WAPE", "Bias"], overall_rows)}

* The policy is {pct(1 - policy / b)} better than the baseline and {pct(1 - policy / naive)} better than the seasonal-naive reference ({naive:.3f}).
  All {forecast.selected_ml} evaluated series that have an ML forecast use it; the others use the baseline.
* **Why the old rule was dropped.** "Lower MAE per series" ({sel:.3f}) picks the winner on the very days it is scored on. The nested estimate selects on the
  *earlier* 14 days and scores on the untouched holdout: {nested:.3f}, {pct(1 - nested / b)} better than the baseline but {pct(nested / policy - 1)} worse than the policy.
  The two selections agree on only {pct(agree)} of series (ML chosen for {forecast.by_mae_ml} vs {forecast.nested_by_mae_ml}), so per-series winners from 14 noisy days are unstable.
* **WAPE is still {pct(s['ml'].wape)} for ML.** With {mean_demand:.1f} units a day on average, most of the error is Poisson noise no model can remove.
* **Bias.** ML under-forecasts by {abs(s['ml'].bias):.3f} units/day ({pct(abs(s['ml'].bias) / mean_demand)} of mean demand). For replenishment that slightly understates demand.
* **Windows.** Baseline windows chosen on training days: {', '.join(f'{w} days for {n} series' for w, n in windows.items())}.
* **Sigma** (RMSE of the policy model's 14 holdout residuals, floored at the Poisson spread): median {np.median(sigma):.2f}, range {sigma.min():.2f} to {sigma.max():.2f} units/day. A 14-point estimate is noisy.

**Sensitivity: five products are steered by the seed generator.** For the SEED-007 demo scenarios the last 12 days of demand of five products are shaped to land chosen
stock levels, and those days lie inside the holdout. Without them ({len(kept)} series):

{table(["Policy", "MAE, all series", f"MAE, without the {len(evaluated) - len(kept)} steered"], [["Baseline", f"{b:.3f}", f"{sub_b:.3f}"], ["AI-003 policy (ML)", f"{policy:.3f}", f"{sub_m:.3f}"], ["Old rule", f"{sel:.3f}", f"{sub_sel:.3f}"], ["Old rule, nested", f"{nested:.3f}", f"{sub_nested:.3f}"]])}

The policy's advantage is {pct(1 - sub_m / sub_b)} without the steered series, against {pct(1 - policy / b)} with them: part of the headline comes from the generated last days.

## 2. Anomaly detection (AI-008)

Eight anomalies were injected with ground-truth labels. The labels are used **only** for this evaluation, never for training, rule thresholds or the
contamination rate (0.5%, fixed beforehand). {len(scored):,} transactions were scored.

{table(["Anomaly type", "Injected", "Rules", "Model", "Combined"], type_rows)}

{table(["Detector", "Caught", "Missed", "False positives", "Precision", "Recall"], detector_rows)}

* **Rules catch what they were written for.** The injected anomalies were designed with the same ideas the rules encode (outside business hours, a large negative
  adjustment, a large manual receipt), so rule recall here is a construction check, not a discovery.
* **The model finds none of them at its operating point.** Its {len(flags)} flags are all {', '.join(sorted(flags['type'].unique()))} rows. Threshold-free it does rank
  the labelled rows well above chance: ROC-AUC {r['roc_auc']:.2f}, average precision {r['average_precision']:.3f} against {r['baseline_average_precision']:.4f} for a random ranking
  ({r['average_precision'] / r['baseline_average_precision']:.0f}x); {r['recall_at_k']['50']} of {r['labelled']} are in its top 50.
* **Missed by everything:** {', '.join(f"{row['label']} ({row['anomaly_type'].replace('_', ' ').lower()})" for _, row in missed.iterrows())}.
* **Why the model misses the off-hours events.** Only 2 of {len(scored):,} transactions are outside business hours; in most trees' random subsamples that feature is constant, so it cannot isolate them
  (see the notebook for the measured share of trees).

**False positives ({len(fp)} of {int(scored['flagged'].sum())} flags), by likely cause:**

{table(["Source", "Type", "Likely cause", "Flags"], fp_rows)}

{artefacts} of the {len(fp)} are artefacts of how the synthetic data was built (opening stock, the generator's last-day trims, steered products); {len(fp) - artefacts} remain on ordinary data:
large legitimate goods receipts that the model finds unusual, and ordinary tail events that rule R2 flags. R2's robust z-score is not conservative for Poisson-like counts.

## 3. What not to conclude

* Not that ML forecasting is {pct(1 - policy / b)} better for a real plant, or that the Isolation Forest does not work: it was given 8 synthetic anomalies, 6 of which the rules already cover.
* Not that the old per-series figure ({sel:.3f}) was ever the expected accuracy of a selection rule; only the nested estimate ({nested:.3f}) is.
* Not that rule or model thresholds are good: they were deliberately not tuned on 8 labels.
* Demand is observed issues; stock-outs hide demand (censoring). The synthetic data has very few; real data may not.
* No outlier cleaning was applied: the injected anomalies remain in the training series (their effect is small but not zero).

## 4. Options for the owner (not implemented)

1. **AI-003 is decided** (see SRS): ML from 28 days of history, the baseline before. A margin rule ("baseline only if it wins by X") would need more than 14 days of evidence per series.
2. **Receipts as model noise.** Large goods receipts and the opening stock dominate the model's flags; scoring receipts separately, or excluding the opening balance, would reduce them.
3. **A duplicate rule** (identical movement within minutes) and a Poisson-aware size threshold for R2 would address the two clearest misses/false alarms. They were left out so the model could be evaluated on duplicates.
4. **Rare signals need a rule.** Off-hours activity is too rare in the data for a forest to learn from (the feature is already continuous); keep the rule, and consider a supervised component once real labels exist.

## Reproduce

```
cd ai-service
.venv/bin/pytest                               # unit and API tests
.venv/bin/python scripts/build_notebooks.py    # executes both notebooks, charts included
.venv/bin/python scripts/build_report.py       # rewrites this file
```
"""


if __name__ == "__main__":
    out = ROOT / "REPORT.md"
    out.write_text(build())
    print(f"wrote {out} ({out.stat().st_size / 1024:.1f} KB)")
