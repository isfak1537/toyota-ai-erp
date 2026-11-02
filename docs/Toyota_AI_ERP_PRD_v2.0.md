**TOYOTA AI ERP**

PRODUCT REQUIREMENTS DOCUMENT

*Product vision, MVP scope, AI core, users and success criteria*

| **Item**   | **Detail**                                                                           |
|------------|--------------------------------------------------------------------------------------|
| Project    | AI-Powered ERP Platform for Manufacturing                                            |
| Version    | 2.0 — Final MVP Baseline                                                             |
| Date       | 2 November 2026                                                                      |
| Supersedes | Version 1.0 — Consolidated Draft (2 November 2026)                                   |
| Status     | Final working baseline for the MVP demo release; formal stakeholder approval pending |

**CONFIDENTIAL — PROJECT WORKING DOCUMENT**

# 1. Document Control

| **Version** | **Date**   | **Change summary**                                                                                                                                                                                                                                                                             |
|-------------|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1.0         | 2 Nov 2026 | Consolidated draft covering the full ERP vision (B1–B14).                                                                                                                                                                                                                                      |
| 2.0         | 2 Nov 2026 | Adds the MVP demo release: Inventory & Procurement module plus AI Core (own ML models for forecasting and anomaly detection, LLM for explanations). Adds zero-cost deployment constraint, human-in-the-loop AI rules and demo success criteria. Full vision retained as the long-term roadmap. |

# 2. Executive Summary

The Toyota AI ERP Platform is a modular, cloud-ready ERP system for
unifying manufacturing and business operations: organization management,
master data, inventory, procurement, sales, manufacturing, finance, HR,
reporting and AI/IoT capabilities on one shared operational platform.

Because the full scope is large, the project will first deliver one
**complete, demonstrable vertical slice**: the **Inventory & Procurement
module** with an **AI Core** that forecasts demand, recommends
replenishment, detects unusual stock activity and explains its reasoning
in plain language. A human approves every AI recommendation before any
business record is created. This MVP shows how the whole ERP will work
and how AI will extend every later module.

**One-line pitch:** an ERP where AI tells you in advance what to buy and
why, and a person approves it.

# 3. Product Vision

Provide a centralized system of record for manufacturing operations,
improve cross-department visibility, reduce duplicate manual work,
standardize workflows and enable data-informed decisions. AI extends
reliable core ERP processes; it does not replace validated business
controls.

# 4. Business Problems and Product Response

**Business context**

| **Business problem**                         | **Product response**                               | **Addressed in MVP?**                        |
|----------------------------------------------|----------------------------------------------------|----------------------------------------------|
| Disconnected departmental systems            | Shared ERP data model and integrated modules       | Partly (master data, inventory, procurement) |
| Duplicate manual data entry                  | Reusable master data and connected workflows       | Yes                                          |
| Limited real-time visibility                 | Dashboards, reports and transaction history        | Yes (inventory dashboard, ledger)            |
| Manual or inconsistent approvals             | Explicit workflow states and approval controls     | Yes (PR/PO approval, AI suggestion approval) |
| Inventory inaccuracies                       | Stock balances, reservations, movements and ledger | Yes                                          |
| Stock-outs and over-stocking                 | AI demand forecast and smart replenishment         | Yes (AI Core)                                |
| Undetected errors or misuse in stock records | AI anomaly detection with review workflow          | Yes (AI Core)                                |
| Difficult production planning                | MRP and AI forecasting                             | No — later batch                             |
| Reactive maintenance                         | Maintenance records and predictive maintenance     | No — later batch                             |

# 5. Product Goals

## 5.1 Long-term goals

- Centralize manufacturing and business operations.

- Provide reliable inventory, procurement and sales workflows.

- Maintain traceable records for stock and financial transactions.

- Support company, factory and warehouse structures.

- Introduce production planning, finance, HR and quality capabilities in
  stages.

- Enable AI-assisted analysis, forecasting and IoT integration.

## 5.2 MVP release goals

- Deliver a working, deployed Inventory & Procurement module with a
  usable web interface.

- Deliver an AI Core with two self-trained ML models (demand
  forecasting, anomaly detection) and an LLM explanation layer.

- Demonstrate the full AI-assisted procure-to-stock loop: forecast →
  suggestion → human approval → requisition → PO → goods receipt → stock
  and ledger update.

- Run at zero cost using free-tier hosting and a free LLM API.

- Give the project manager a clear, honest picture of the architecture
  and how later modules plug in.

# 6. Target Users

## 6.1 All user groups (long-term)

**User groups**

| **User group**         | **Primary needs**                                            |
|------------------------|--------------------------------------------------------------|
| System administrator   | Configuration, access and operational oversight              |
| Executive / management | Cross-functional KPIs, reports and business visibility       |
| Factory manager        | Factory operations and production visibility                 |
| Warehouse manager      | Stock accuracy, receipts, issues, reservations and transfers |
| Procurement officer    | Suppliers, requisitions, purchase orders and receipts        |
| Sales manager          | Customers, sales orders, deliveries and receivables          |
| Production manager     | Production orders, material availability and planning        |
| Quality officer        | Inspection, defects and quality records                      |
| HR manager             | Employee, attendance and payroll operations                  |
| Accountant             | Invoices, payments, journals and financial reporting         |

## 6.2 MVP personas

| **Persona**         | **What they do in the MVP**                                                                                   |
|---------------------|---------------------------------------------------------------------------------------------------------------|
| Warehouse Manager   | Views stock dashboard and ledger; performs receipts, issues, adjustments, transfers; reviews anomaly flags.   |
| Procurement Officer | Reviews AI replenishment suggestions; approves or rejects them; manages requisitions, POs and goods receipts. |
| Manager (Viewer)    | Read-only access to dashboard, AI insights and reports; can ask the AI assistant questions.                   |
| Administrator       | Manages users and roles; triggers model retraining; sees AI audit log.                                        |

# 7. Product Scope

## 7.1 MVP scope (in scope)

- **Organization & master data (existing):** company, factory,
  warehouse, product, category, supplier, supplier-product.

- **Inventory (existing, hardened):** balances, receipt, issue,
  adjustment, reservation/release, transfer, low stock, stock ledger.

- **Procurement (existing, hardened):** requisition, approval, purchase
  order, goods receipt, purchase invoice.

- **AI Core (new):** demand forecasting, smart replenishment
  suggestions, anomaly detection, LLM explanations, read-only AI
  assistant, AI audit log.

- **Minimal authentication & roles (new):** login and four roles so
  approvals are attributed to a real user.

- **Web interface (new):** dashboard, AI suggestions, anomalies,
  procurement screens, ledger, AI assistant.

- **Synthetic demo data (new):** 90 days of realistic, reproducible
  stock history.

- **Free deployment (new):** public demo URL.

## 7.2 Out of MVP scope (kept on roadmap)

- Sales & CRM completion (delivery, sales invoice, payment, receivables)
  — B5 remainder.

- Manufacturing, MRP, maintenance, quality, HR/payroll, finance &
  accounting (B6–B11).

- Full RBAC matrix, SSO and audit across all modules (B12 complete).

- IoT telemetry, supplier-risk scoring, predictive maintenance (rest of
  B13).

## 7.3 Deferred scope

- Training or fine-tuning a custom large language model.

- Physical IoT hardware rollout.

- Country-specific tax compliance, multi-currency consolidation and
  third-party integrations.

# 8. AI Core — Product Definition

The AI Core is a reusable layer. In the MVP it serves inventory and
procurement; later modules add their own data tools and models to the
same core.

**AI capabilities**

| **Capability**      | **What the user gets**                                                                       | **How it works (summary)**                                                                                              |
|---------------------|----------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------|
| Demand forecasting  | Expected daily consumption per product and warehouse for the coming weeks, with uncertainty. | Self-trained ML model (Python, scikit-learn) on stock-issue history, compared against a simple moving-average baseline. |
| Smart replenishment | "Order 200 units of Brake Pad from Supplier X now" — with quantity, supplier and reason.     | Deterministic formula using forecast, supplier lead time, safety stock, MOQ, current and on-order stock.                |
| Anomaly detection   | List of suspicious stock movements with a reason, for human review.                          | Self-trained Isolation Forest model plus transparent rules.                                                             |
| AI explanation      | Plain-language explanation for every suggestion and anomaly.                                 | Free LLM API (Groq primary, Gemini fallback) writing text from computed facts.                                          |
| AI assistant        | Ask questions like "Which products will run out next week?"                                  | LLM with read-only data tools; it cannot change records.                                                                |

## 8.1 AI principles

- **Human-in-the-loop:** AI only suggests. A person approves before any
  requisition or record is created.

- **Numbers come from code, words from the LLM:** quantities and
  forecasts are computed by models and formulas; the LLM only explains
  them.

- **Read-only AI:** the AI service and assistant have no write access to
  business data.

- **Transparency:** every suggestion shows its inputs (forecast, lead
  time, safety stock, stock levels).

- **Graceful degradation:** if the LLM is unavailable, suggestions still
  work without the explanation text.

- **Honest evaluation:** model accuracy is measured and reported against
  a baseline, including when the model does not beat it.

- **Auditability:** every AI suggestion and every human decision is
  logged.

# 9. Key Business Workflows

## 9.1 AI-assisted procure-to-stock (MVP core workflow)

Stock history → Forecast model → Replenishment suggestion (+ LLM
explanation) → Procurement Officer approves → Draft Purchase Requisition
→ Submit & approve → Purchase Order → Approve → Goods Receipt →
Inventory and Stock Ledger updated → Purchase Invoice.

## 9.2 Anomaly review (MVP)

Stock transactions → Anomaly model and rules → Anomaly flag with reason
→ Warehouse Manager reviews → Marked reviewed (with note).

## 9.3 Order-to-cash (roadmap)

Customer → Sales Order → Warehouse Assignment → Stock Reservation →
Delivery → Inventory Issue → Sales Invoice → Customer Payment →
Receivables update.

## 9.4 Plan-to-produce (roadmap)

Demand / Sales Orders → MRP → Material Availability → Production Order →
Material Issue → Production Execution → Quality Inspection → Finished
Goods Receipt.

# 10. MVP Feature List and Priority

| **ID** | **Feature**                                                                              | **Priority** |
|--------|------------------------------------------------------------------------------------------|--------------|
| F-01   | Inventory dashboard: stock, available, low-stock and days-of-cover per product/warehouse | Must         |
| F-02   | Stock ledger view with filters                                                           | Must         |
| F-03   | Procurement screens: requisition, PO, goods receipt (create, submit, approve)            | Must         |
| F-04   | Run replenishment: generate AI suggestions                                               | Must         |
| F-05   | Suggestion review: inputs, explanation, approve/reject → draft requisition               | Must         |
| F-06   | Demand forecast chart per product (history + forecast + baseline)                        | Must         |
| F-07   | Anomaly list with reason and review action                                               | Must         |
| F-08   | Login and role-based access (4 roles)                                                    | Must         |
| F-09   | Model evaluation page: MAE vs baseline, anomaly detection results                        | Should       |
| F-10   | AI assistant chat (read-only questions)                                                  | Should       |
| F-11   | AI audit log view                                                                        | Should       |
| F-12   | Purchase invoice screen                                                                  | Could        |
| F-13   | Model retrain trigger from UI                                                            | Could        |

# 11. Product Principles and Constraints

- Modular monolith for the ERP backend; a separate Python service only
  for ML workloads.

- Shared master data and explicit module boundaries.

- Change stock only through controlled stock operations, never by direct
  quantity edits.

- Critical multi-record operations must be atomic, concurrency-safe and
  traceable.

- Enforce business rules and permissions on the server.

- AI must use validated data and must not silently change financial or
  inventory records.

- **Zero-cost constraint:** only free tiers (hosting, database, LLM
  API). Free-tier limits change; they must be verified at deployment
  time.

- **Demo data is synthetic** and must be labelled as such. No real
  company or personal data is sent to free AI APIs.

- The "Toyota" name is used as a demonstration context for a personal
  project, not as an official Toyota product.

# 12. Success Measures

## 12.1 MVP demo acceptance

- The full AI-assisted procure-to-stock loop (section 9.1) runs
  end-to-end on the deployed URL.

- Every AI suggestion shows its inputs and an explanation; approving one
  creates a linked draft requisition.

- Stock balances reconcile with the ledger after the demo workflow.

- Seeded anomalies are visible in the anomaly list with reasons.

- The system keeps working (without explanation text) when the LLM API
  is unavailable.

## 12.2 AI quality measures

- Forecast: mean absolute error (MAE) on a 14-day holdout, reported for
  the ML model and the moving-average baseline.

- Anomaly detection: how many of the deliberately injected anomalies are
  detected, and how many false flags appear.

- No numeric accuracy target is fixed in advance; results are measured
  and reported honestly. Targets for later releases will be set from
  these baselines.

## 12.3 Long-term business measures

Inventory accuracy, purchase-order cycle time, stock-out frequency,
order fulfilment rate, on-time delivery, production-plan adherence,
receivables ageing, user adoption and system reliability. Numeric
targets require stakeholder baselines.

# 13. Assumptions, Risks and Open Decisions

- Manufacturing organization with company, factory and warehouse
  structure is the operating context.

- Free-tier limits (LLM requests per day, hosting sleep, database size)
  may change and could affect the demo; a fallback LLM provider is
  required.

- Synthetic data can make models look better than they would on real
  data; this must be stated in the demo.

- Approval authority and segregation-of-duties rules require stakeholder
  confirmation.

- Tax, invoice numbering, payment methods and accounting policies
  require finance review (post-MVP).

- Authentication beyond the MVP (password policy, sessions, full role
  matrix) requires approval.

- Data retention, backup and disaster-recovery requirements remain to be
  specified for production.

# Approval

**Approval record**

| **Role**                 | **Name**                         | **Signature / Date**             |
|--------------------------|----------------------------------|----------------------------------|
| Product / Business Owner | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Technical Lead           | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
| Project Manager          | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ | \_\_\_\_\_\_\_\_\_\_\_\_\_\_\_\_ |
