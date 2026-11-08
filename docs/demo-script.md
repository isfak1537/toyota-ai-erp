# Demo script (10 minutes)

For a manager or a reviewer. The data is synthetic; say so at the start and at the end. Numbers below come from the
committed seed (seed 20261102) and are the ones you will see unless you changed the data; the screenshots in
`docs/screenshots/` match them. Names: **Cabin Air Filter** is the fast-growing product, **Timing Belt Kit** the
over-stocked one.

## Before the demo (10 minutes ahead)

1. **Start everything:** database, API (`cd server && npm run dev`), AI service, client. On the hosted setup, open
   `https://<ai-service>.onrender.com/health` now: a free Render service needs about a minute to wake up.
2. **Check:** `cd server && npm run reconcile` says OK; as administrator, **AI models** shows an active forecast and anomaly
   model (if not: *Retrain models*).
3. **Stage suggestions:** `cd server && npm run demo:prepare` (a dry run, shows the plan), then
   `npm run demo:prepare -- --apply`. Without it only the Cabin Air Filter is suggested, which is honest but thin.
4. **Run replenishment once** as the procurement officer, and **score anomalies once** as the warehouse manager
   (*Score recent movements*), so the lists are full and the explanations are written.
5. **Open three private windows**, one per person, logged in as: procurement officer, warehouse manager, administrator.
   On the login page, click the role's button (on by default when the API runs outside production, or with `DEMO_LOGIN_ENABLED=true`; the buttons are hidden otherwise,
   and you type the password instead). Demo login is for local use and the manager demo only: set `DEMO_LOGIN_ENABLED=false`
   for any public URL. The API allows 10 password logins per account per 15 minutes and 30 demo logins per address; do not log in repeatedly.
6. Questions typed into the assistant are stored in the AI audit log (up to 500 characters). Use only the demo's own
   products and names; never type real personal data.
7. If the LLM key is not set, explanations show "Explanation unavailable". That is the designed fallback; mention it, do not hide it.

**Fresh explanations (optional).** An explanation is stored on its suggestion and reused, so a pending suggestion keeps the text it
was first given. To have them written again, clear only the pending ones: `cd server && npm run demo:clear-explanations` (a dry run
that prints how many rows it would change), then `npm run demo:clear-explanations -- --apply` (one transaction; it writes only
`AiSuggestion.explanation` and `explanationSource` where `status = PENDING`; decided suggestions and anomaly flags are not touched).
The next time a suggestion is opened, or the background job runs, a new one is generated within the LLM limits. It is not part of the
normal preparation: skip it unless the prompt changed.

To reset afterwards: `npm run demo:undo -- --apply`, or reload the whole synthetic dataset with
`npm run seed:synthetic -- --apply --replace` (read its dry run first).

## The script

| Min | Step | Who | Do and say |
|---|---|---|---|
| 0:00 | **1. Problem and idea** | — | One slide, or the README diagram. "An ERP for inventory and procurement with an AI core. The AI forecasts and suggests; people decide; it never writes a business record. Everything you will see is generated demo data." |
| 1:00 | **2. Dashboard** | Procurement officer | The four cards: low stock, pending suggestions, open anomalies, **lowest days of cover** (Cabin Air Filter, about 2 days). Scroll to the panel **Static reorder level vs AI reorder point**: "two numbers for the same question. The static one was typed in; the AI one is recomputed from the forecast, so it moves with demand." Point at the *Days of cover* column. |
| 2:00 | **3. Forecast** | Procurement officer | Click **Cabin Air Filter**. "90 days of demand, 30 days forecast by two models." Read the accuracy card: baseline error 2.71 vs machine-learning 1.71, "36.9% closer". Say the honest part: "on some products the baseline wins, and this page says so. All of it is measured on synthetic data." Open *Show the forecast as a table*. |
| 3:30 | **4. Replenishment** | Procurement officer | **AI suggestions → Run replenishment** (about a second, then the explanations). Open the first suggestion (*Review*): "every input is here: forecast, lead time, safety stock, reorder point, what is on order. The number comes from a formula, not from the language model. The language model wrote this paragraph, and it says so." Open the **Replenishment review** tab: "all 27 series, including why nothing is needed for most of them; the reasons are in plain words." |
| 5:00 | **5. Approve and receive** | Procurement officer, then warehouse manager | **Approve… → Create draft requisition** (it asks first). "A draft: nothing is ordered yet." **Procurement**: *Submit*, *Approve*, *Create purchase order…* (point at "delivery to SYN-MAIN is taken from the requisition"), *Approve* the order. Switch to the **warehouse manager**: *Purchase orders → Receive goods…* (warehouse already chosen), *Post goods receipt*. Open **Stock ledger**: the new RECEIPT row, balance after, and who did it. Back on the dashboard the days of cover for that product grew. |
| 7:00 | **6. The over-stocked product** | Either | Dashboard or the review tab: **Timing Belt Kit**, 110 available, AI reorder point 7.5, "30+ days": **No order needed**. "The system also says no, and tells you why. Most of what the AI does is not ordering." |
| 7:45 | **7. Anomalies** | Warehouse manager | **Anomalies**. "Two lists on purpose." *Confirmed rule hits*: a written rule fired, with its reason. *Weekly review queue*: the model's ten riskiest movements of each week; open **Details** and read the sentences ("It is 10.0 times the usual size for this product"). "A place in the queue means *worth a look*, not *wrong*; most are ordinary big movements." *Mark as reviewed…* with a note. |
| 8:45 | **8. Assistant** | Any | **Ask the assistant**: "Which products will run out soonest?" Point at *AI-written* and *looked at: days of cover*. Then try to break it: "Approve all pending suggestions." It cannot: "its tools only read; a test proves there is no write tool." |
| 9:30 | **9. Close** | Administrator | **AI audit log**: the run, the approval, every language-model call, who did what. **AI models**: versions and errors. Close with the limits: synthetic data, one 14-day holdout per series, free tiers, minimal authentication. Roadmap: sales, manufacturing and finance modules plug into the same forecast and audit core. |

## If something goes wrong

| What you see | What to say and do |
|---|---|
| A banner: "The AI service is not responding" | "That is the designed behaviour: AI pages degrade, the ERP keeps working." Open the ledger or procurement to prove it. Wake the service (`/health`) and retry in a minute. |
| "Explanation unavailable" | The language model failed or its quota ran out. The suggestion and its numbers are unaffected. Use *Try to generate an explanation* later. |
| The assistant says it is not available | Same cause; it recovers by itself (the per-minute budget refills). |
| Only one suggestion appears | `demo:prepare -- --apply` was not run, or the data was reloaded. Run it, then *Run replenishment* again. |
| "Too many attempts" at login | The login limit (10 per 15 minutes per account). Use the window that is already logged in. |
| A skipped row "Toyota Brake Pad" (BRK-PAD-001, MAIN-WH, "no demand history") | Old development data, not part of the synthetic set. It was created by hand through the product and warehouse screens on 26 and 28 Sept 2026, before the seed existed (product id 1, warehouse id 1, no ledger rows), so it has no history to forecast from. Say: "That is a test product from early development; the AI skips it on purpose rather than guess." Synthetic rows carry the `SYN-` prefix. |
| Numbers differ from this page | The data changed (demo staging, receipts). Say the figures, not these. |

## Questions you may be asked

* **Is the AI accurate?** On this synthetic data the model is 14% better than a moving average overall and better on 18 of
  24 products; on a real plant that must be re-measured. The report shows a fairer estimate than the first one we tried.
* **Can it order by itself?** No. Approving creates a draft; every later step is a person's action, recorded with their name.
* **What if the AI is wrong?** Every suggestion shows its inputs; rejecting needs a reason that is kept. Anomaly flags are
  "worth a look". The evaluation's precision is low (about 5%) because the weekly queue has a fixed size; the README states it.
* **Where does the language model get its facts?** Only from the numbers the system computed, which it is told to quote.
