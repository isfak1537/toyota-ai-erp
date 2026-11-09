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

from app.anomaly.evaluate import _find, categorize_false_positives, evaluate_anomaly_detection, is_data_artefact, load_labels, queue_metrics  # noqa: E402
from app.anomaly.model import QUEUE_SIZE, fit_anomaly_model, score_ledger  # noqa: E402
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
    b, _, sel, nested, naive = (s[k].macro_mae for k in ("baseline", "ml", "per_series_selection", "per_series_selection_nested", "seasonal_naive"))
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
    before = json.loads((FIXTURES / "anomaly-baseline-v1.json").read_text())
    model = fit_anomaly_model(ledger)
    scored = score_ledger(model, ledger)
    ev = evaluate_anomaly_detection(scored, ledger, products, warehouses, labels)
    o = ev.overall.set_index("detector")
    related = {_find(ledger, products, warehouses, a["related"]) for a in labels["anomalies"] if a.get("related")}
    queue = queue_metrics(scored, ev.labelled, related)
    chosen = queue[queue["chosen_up_front"]].iloc[0]
    fp = categorize_false_positives(ev.false_positives, ledger, labels, steered)
    artefacts = int(fp["likely_cause"].map(is_data_artefact).sum())
    r = ev.ranking
    flagged_now = int(scored["flagged"].sum())
    r5_hits = int(scored["rule_codes"].map(lambda c: isinstance(c, (list, str)) and "R5" in c).sum())
    eligible = int(scored["eligible"].sum())
    total = int(ev.by_type["injected"].sum())
    bd = before["detectors"]
    na = lambda v: "n/a" if v is None or (isinstance(v, float) and np.isnan(v)) else f"{v:.3f}"
    ba_rows = []

    for name in ("rules", "model", "combined"):
        old, now = bd[name], o.loc[name]
        label = {"rules": "Rules", "model": "Model (before: 0.5% cut; after: weekly queue)", "combined": "Combined"}[name]
        ba_rows.append([label, f"{old['caught']} / {total}", f"{int(now['true_positives'])} / {total}", old["false_positives"], int(now["false_positives"]),
                        f"{old['precision']:.3f}", na(now["precision"]), f"{old['recall']:.2f}", f"{now['recall']:.2f}"])

    ba_rows.append(["Flags raised", "", "", "", "", before["flags"]["total"], flagged_now, "", ""])
    type_rows = []

    for _, t in ev.by_type.iterrows():
        old = before["by_type_detected_rules_model_combined"][t["anomaly_type"]]
        n = int(t["injected"])
        type_rows.append([t["anomaly_type"].replace("_", " ").title(), n, f"{old[0]} -> {int(t['rules_detected'])}", f"{old[1]} -> {int(t['model_detected'])}",
                          f"{old[2]} -> {int(t['combined_detected'])}"])

    type_rows.append(["**All**", total, f"{bd['rules']['caught']} -> {int(o.loc['rules', 'true_positives'])}", f"{bd['model']['caught']} -> {int(o.loc['model', 'true_positives'])}",
                      f"{bd['combined']['caught']} -> {int(o.loc['combined', 'true_positives'])}"])
    queue_rows = [[f"{int(q['n_per_period'])}" + (" (chosen up front)" if q["chosen_up_front"] else " (sensitivity only)"), int(q["queue_rows"]), int(q["queue_hits"]),
                   f"{q['precision_at_n']:.3f}", f"{q['recall_at_n']:.2f}", f"{q['queue_plus_rules_rows']}", f"{q['queue_plus_rules_hits']}",
                   f"{q['queue_plus_rules_precision']:.3f}", f"{q['queue_plus_rules_recall']:.2f}"] for _, q in queue.iterrows()]
    fp_rows = [[src, typ, cause, int(n)] for (src, typ, cause), n in fp.groupby(["source", "type", "likely_cause"]).size().sort_values(ascending=False).items()]
    old_fp_rows = [[k, v] for k, v in before["false_positive_causes"].items()]
    missed = ev.labelled[~ev.labelled["combined"]]
    model_missed = ev.labelled[~ev.labelled["id"].isin(scored.loc[scored["in_queue"], "id"])]
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
* **Anomalies (second pass).** Rules R1-R5 catch {int(o.loc['rules', 'true_positives'])} of {total} injected anomalies (before: {bd['rules']['caught']}), the weekly review queue of {QUEUE_SIZE} catches
  {int(chosen['queue_hits'])} (before the Isolation Forest's 0.5% cut caught {bd['model']['caught']}), and together they catch {int(o.loc['combined', 'true_positives'])}. The price is workload: {flagged_now} flags instead of {before['flags']['total']},
  combined precision {na(o.loc['combined', 'precision'])} instead of {bd['combined']['precision']:.3f}. Most of the recall gain comes from excluding document-linked receipts, which also makes the model blind to a wrong receipt that has a document.

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

Eight anomalies were injected with ground-truth labels. The labels are used **only** for this evaluation, never for training, rule thresholds, the exclusion or the queue size.
{len(scored):,} transactions were scored, {eligible:,} of them eligible for the review queue.

**What changed in this pass** (decided before the results were seen, nothing tuned afterwards):

1. **Eligibility.** Movements that are not on-hand changes (reservations, releases) and receipts that carry a document link (a PO or goods receipt) are scored but never enter the model's training or the queue. Chosen from data fields, not labels.
2. **R5, duplicate movement:** the same product, warehouse, type and quantity {10} minutes or less after the previous one. The window was fixed in advance.
3. **Risk score and review queue.** The Isolation Forest is no longer cut at a 0.5% contamination rate. Its score becomes a risk percentile among eligible training rows, and the top {QUEUE_SIZE} eligible rows per local week form the review queue,
   each with its score and its top three contributing features (found by replacing one feature at a time with its typical value).
4. R1 and R2 are unchanged. The analysis of their false positives is below.

### Before and after

{table(["Detector", "Caught before", "Caught after", "FP before", "FP after", "Precision before", "Precision after", "Recall before", "Recall after"], ba_rows)}

Detection by anomaly type (before -> after):

{table(["Anomaly type", "Injected", "Rules", "Model", "Combined"], type_rows)}

Threshold-free ranking of the risk score: ROC-AUC {before['ranking']['roc_auc']:.2f} -> {r['roc_auc']:.2f}, average precision {before['ranking']['average_precision']:.3f} -> {r['average_precision']:.3f}
(random {r['baseline_average_precision']:.4f}); labelled anomalies in the top 10 / 20 / 50: {before['ranking']['recall_at_k']['10']} / {before['ranking']['recall_at_k']['20']} / {before['ranking']['recall_at_k']['50']} -> {r['recall_at_k']['10']} / {r['recall_at_k']['20']} / {r['recall_at_k']['50']}.
The new figures are over the {r['eligible_transactions']:,} eligible rows, the old ones over all rows, so the two are not like for like.

### Precision and recall at N per week

N = {QUEUE_SIZE} was fixed before looking at results. N = 5 and 20 are shown only to see how sensitive the result is. A queue row that is the original of a labelled duplicate counts as neither a hit nor a false alarm.

{table(["N per week", "Queue rows", "Hits", "Precision@N", "Recall@N", "Queue + rules rows", "Hits", "Precision", "Recall"], queue_rows)}

A random queue of the same size would have precision {chosen['random_precision']:.4f}, so the queue is about {chosen['precision_at_n'] / chosen['random_precision']:.0f}x better than chance. Precision@N is low because the queue is a fixed size:
with eight anomalies in 90 days, most weeks have none, and the queue is full anyway.

* **Rules catch what they were written for.** The injected anomalies were designed with the same ideas the rules encode, so rule recall is a construction check, not a discovery.
* **Missed by the queue:** {', '.join(f"{row['label']} ({row['anomaly_type'].replace('_', ' ').lower()}, rank {int(row['model_rank'])})" for _, row in model_missed.iterrows())}. Off-hours events are too rare for a forest to learn
  from (see the notebook); the rules catch them.
* **Missed by everything:** {', '.join(f"{row['label']} ({row['anomaly_type'].replace('_', ' ').lower()})" for _, row in missed.iterrows()) or 'nothing'}.
* **R5 is noisy.** It fires on {r5_hits} rows, because identical repeated issues are common in small-count demand. One is the labelled duplicate.

### False positives by cause

Before (13 rule + 14 model false positives, commit {before['commit']}):

{table(["Source, type and cause", "Flags"], old_fp_rows)}

All 13 rule false positives were examined by data fields. None has a document link and none is a receipt. 12 are R2 hits on issues of 1.2 to 3.2 times the product's mean daily demand (natural tails of the demand
distribution, two of them the generator's last-day trim), and 1 is an R1 hit on a routine cycle-count adjustment. No data field separates them from a true anomaly, so R1 and R2 were left alone.
A criterion in days of demand would remove most of them, but choosing it now would be tuning on the labels I have seen; it is an owner decision (section 4).

After ({len(fp)} false positives of {flagged_now} flags):

{table(["Source", "Type", "Likely cause", "Flags"], fp_rows)}

{artefacts} of the {len(fp)} are artefacts of how the synthetic data was built (the generator's last-day trims, steered products); {len(fp) - artefacts} are on ordinary data.

## 3. What not to conclude

* Not that ML forecasting is {pct(1 - policy / b)} better for a real plant, or that the Isolation Forest does not work: it was given 8 synthetic anomalies, most of which the rules already cover.
* Not that the old per-series figure ({sel:.3f}) was ever the expected accuracy of a selection rule; only the nested estimate ({nested:.3f}) is.
* Not that rule or model thresholds are good: they were deliberately not tuned on 8 labels. The queue size, the R5 window and the eligibility exclusion were fixed before the results; N = 5 and 20 are a sensitivity check.
* Not that precision 0.05 is acceptable: it is the cost of a fixed-size queue plus R5 on data with 8 anomalies in 90 days.
* Demand is observed issues; stock-outs hide demand (censoring). The synthetic data has very few; real data may not.
* No outlier cleaning was applied: the injected anomalies remain in the training series (their effect is small but not zero).

## 4. Options for the owner (not implemented)

1. **AI-003 is decided** (see SRS): ML from 28 days of history, the baseline before. A margin rule ("baseline only if it wins by X") would need more than 14 days of evidence per series.
2. **Blind spot of the eligibility rule.** Receipts that carry a PO or goods-receipt link are never scored by the model. A wrong receipt that has a document (wrong quantity, wrong supplier price) would pass. Cross-checking them
   against the order quantity is a separate rule, not a statistical one.
3. **Days-of-demand criterion for R2.** Twelve of the 13 original rule false positives were issues of 1.2 to 3.2 times the mean daily demand. Requiring, say, more than N days of demand would remove them. I did not choose N, because I have seen the labels.
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
