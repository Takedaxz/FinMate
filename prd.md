# FinMate — Autonomous AI Portfolio Advisor (MVP)
> **An AWS-native, reasoning-first personal finance agent** that analyzes a user’s stock portfolio, explains risks, and proposes actionable rebalancing suggestions. Built for the AWS AI Agent Global Hackathon with a **pure reasoning LLM** (no prediction engine).

---

## 0) Hackathon Requirements (Explicit Mapping)

| Requirement | How FinMate Meets It |
|---|---|
| **LLM hosted on AWS Bedrock or SageMaker** | Uses **Amazon Bedrock** (Nova or Claude via Bedrock) as the core reasoning model. |
| **Use ≥1 of: Bedrock AgentCore, Bedrock/Nova, Amazon Q, SageMaker AI, SDKs for Agents/Nova Act SDK, AWS Transform, Kiro** | Uses **Amazon Bedrock AgentCore** (tool-use primitive) + **Bedrock/Nova** as the LLM. *(Optional add-on: Amazon Q chat front-end.)* |
| **Meets AWS-defined AI agent qualification** | Reasoning LLM, autonomous plan–act loop, tool integrations, and stateful context (session memory + S3). |
| **Uses reasoning LLMs for decision-making** | Bedrock LLM evaluates diversification, concentration, risk exposure, and generates rationale-backed actions. |
| **Demonstrates autonomous capabilities (with or without human input)** | Scheduled **Daily Check** (EventBridge → Lambda → AgentCore) runs **without user prompt**, posts a summary & suggested actions. |
| **Integrates APIs / databases / external tools / other agents** | **External APIs** for market data (e.g., Alpha Vantage / Polygon / Yahoo Finance), **S3** for portfolio state & reports, **code execution** in Lambda tools. |
| **Optional helper services (Lambda, S3, API Gateway)** | **Lambda** (tool functions & webhooks), **S3** (storage), **API Gateway** (HTTP endpoints). |

> **Scope note:** This is an MVP, not production-grade. It focuses on correctness of the agent loop, explainability, and reliable tool integration within the hackathon budget.

---

## 1) Overview

**FinMate** is a **reasoning-first AI agent** that reads a user’s portfolio (CSV/JSON or broker API), fetches live quotes & market context, **explains** portfolio health (diversification, concentration, sector tilt, beta exposure), and proposes **actionable rebalancing suggestions** (what to trim/add and why).  
No prediction/price forecasting models are used—**all recommendations are driven by rules + LLM reasoning** grounded in current data.

**Primary Users:** retail investors who want transparent, explainable guidance.  
**Non-goal (MVP):** executing live trades; we only **simulate** suggested actions.

---

## 2) Goals & Non-Goals

**Goals**
- Provide **clear, auditable recommendations** with rationale and references to the user’s data.
- Demonstrate **autonomous operation** via a daily scheduled review that runs end-to-end without a prompt.
- Keep architecture **serverless & low-cost** using Bedrock + Lambda + S3 + API Gateway.

**Non-Goals (MVP)**
- Live brokerage execution or KYC/PII handling.
- Advanced risk models (Monte Carlo/Value-at-Risk) or ML price prediction.
- Multi-currency tax optimization and fee modeling.

---

## 3) Core User Stories (MVP)

1. **Upload & Analyze**  
   *As a user*, I upload a CSV with my tickers/units/cost-basis; the agent returns **current weights**, **sector exposure**, **top concentrations**, and **red flags** (e.g., >50% in one sector).

2. **Explain & Recommend**  
   *As a user*, I ask “What should I change for medium risk?” The agent proposes a **before/after target allocation** and a **transaction plan** (simulated), with a **why** for each step.

3. **Autonomous Daily Check**  
   *As a user*, I get a daily summary with **PnL since last run**, **material news impacts**, and **1–3 suggested actions** with rationale—even if I don’t ask for it.

---

## 4) MVP Features

- **Portfolio ingestion** (CSV via UI/API or JSON body) + schema validation.  
- **Data fetch tool**: real-time prices, sector classifications, beta (via API).  
- **Computed analytics** in Lambda tool: weights, concentration (>X%), sector tilt, realized/unrealized PnL (basic), portfolio beta (weighted).  
- **Reasoning + recommendations** via Bedrock: clear, step-by-step explanation, including alternative options.  
- **Report generation**: markdown/HTML summary saved to S3; downloadable link returned.  
- **Autonomous scheduled run** (EventBridge → Lambda → AgentCore) posting a daily recap & suggestions.  
- **(Optional)** Amazon Q chat UI for conversational queries.

---

## 5) System Architecture

**Services**
- **Amazon Bedrock**: Nova/Claude reasoning LLM.  
- **Amazon Bedrock AgentCore**: plan–act–reflect loop; **tool-use primitive** to call Lambda tools.  
- **AWS Lambda**: tool implementation (market data calls, calculations, report build).  
- **Amazon API Gateway**: REST endpoints for upload/analyze/report.  
- **Amazon S3**: store portfolio files, cached market data (optional), generated reports.  
- **Amazon EventBridge**: schedule autonomous “Daily Check”.  
- **(Optional)** Amazon Q: natural-language UI.

**Data Flow (MVP)**
```
[Client/UI] ──> API Gateway ──> Lambda(app) ──> S3 (portfolio file)
│
▼
Bedrock AgentCore (LLM)
│       │        │
│   [Tool: get_market_data] ──> External Market API(s)
│   [Tool: compute_metrics]  ──> Lambda (calc)
│   [Tool: write_report]     ──> S3 (HTML/MD)
▼
Response (rationale + suggestions + report_url)

[Autonomy] EventBridge (daily) ──> Lambda(trigger) ──> AgentCore run ──> S3 report
```

---

## 6) Agent Design (Plan–Act–Reflect)

**AgentCore primitives used (MVP):**
- **Tool Use (Actions)**: invoke Lambda tools with JSON schemas.
- **Planning / Self-Consistency**: LLM breaks tasks into steps, chooses tools, verifies pre/post-conditions.
- **Short-term Session Memory**: pass intermediate results; persistent state in S3 (portfolio + last report).

**Defined Tools (Lambda-backed)**
1. `get_market_data(tickers: string[]) -> {quotes, sectors, betas}`  
2. `compute_metrics(portfolio, market_data, rules) -> {weights, sector_exposure, top_concentration, w_beta, flags}`  
3. `write_report(summary_html) -> {s3_url}`  
4. `get_news(tickers: string[], lookback_days: int) -> [{ticker, headline, url, impact_hint}]` *(optional if API available)*

**Reasoning Guardrails**
- Always **cite** which data point drove a suggestion (ticker, weight%, sector, beta).  
- Provide **two options** when confidence is low (e.g., diversify into healthcare **or** consumer staples).  
- Include **“Not financial advice”** disclaimer on every output.

---

## 7) External Integrations (MVP)

- **Market Data**: Alpha Vantage / Polygon / Financial Modeling Prep / Yahoo Finance (choose one based on key availability).  
- **News (optional)**: NewsAPI / Financial Modeling Prep news endpoint for headline summaries.  
- **Storage**: S3 for portfolios & generated reports.

> **Tip for hackathon:** pick a single provider with an easy free tier; cache last response in S3 to reduce calls.

---

## 8) Data Model (MVP)

**Portfolio CSV**
```csv
ticker,units,cost_basis_ccy,acquisition_date(optional)
AAPL,15,150,2023-08-01
MSFT,5,320,2023-09-13
NVDA,2,440,2024-03-05
```

**Normalized Portfolio JSON (internal)**
```json
{
  "user_id": "demo-user",
  "as_of": "2025-10-04",
  "positions": [
    {"ticker":"AAPL","units":15,"last_price":181.24,"sector":"Technology","beta":1.20},
    ...
  ],
  "cash_ccy":"USD",
  "settings":{"risk":"medium","max_single_name_weight":0.25}
}
```

**Report Object**
```
s3://finmate-reports/{user_id}/{date}/summary.html
```

---

## 9) API Endpoints (via API Gateway → Lambda)

* `POST /portfolio/upload` — body: CSV (multipart) or JSON; returns `{portfolio_id}`
* `POST /portfolio/analyze` — body: `{portfolio_id, risk_prefs}`; triggers AgentCore; returns `{summary, suggestions[], report_url}`
* `GET /report/latest?user_id=...` — returns `{report_url}`
* `POST /simulate/rebalance` — body: `{target_weights}`; returns `{before, after, delta, note}` *(no brokerage execution)*

**Auth (MVP):** simple API key or temporary demo token.

---

## 10) Requirements & Acceptance Criteria (MVP)

* **R1 — LLM Reasoning**: Outputs include portfolio metrics **and** a **natural-language explanation** with cited data points.
* **R2 — Tool Integration**: AgentCore calls at least two tools (`get_market_data`, `compute_metrics`).
* **R3 — Autonomy**: EventBridge-triggered **Daily Check** produces a report without user prompt.
* **R4 — Report**: Generates an S3-hosted HTML/MD report with **weights table**, **sector pie**, **top-3 risks**, and **action list**.
* **R5 — Safety**: Every response includes **“Not financial advice”** and avoids deterministic price predictions.

---

## 11) UX & Demo Flow (3 minutes)

1. **Upload CSV** → success toast with detected tickers & holdings.
2. Click **Analyze** → spinner → **summary appears** (weights, sector exposure) + **suggestions** (trim/add with rationale).
3. Open **Report** (S3 URL) → shows neat summary (tables + simple charts).
4. Show **Daily Check** run (trigger manually) → new report generated automatically with “since last run” delta.
5. *(Optional)* Ask Amazon Q: “Which position contributes most to portfolio beta?”

---

## 12) Prompts (LLM)

**System Prompt (excerpt)**

* You are FinMate, a portfolio analysis agent.
* Use **only current portfolio & market data** provided via tools.
* Explain **why** for each suggestion; avoid predictions; suggest **diversification** and **position sizing** aligned to user risk (low/med/high).
* Always include: “This is not financial advice.”

**Tool Call Instruction (pattern)**

* If you lack prices/sectors/betas, call `get_market_data`.
* After data is present, call `compute_metrics`.
* Produce final answer with: Top risks (ranked), Suggested actions (max 3), Rationale per action, Links (report_url).

---

## 13) Security, Cost, and Limits (MVP)

* **Security**: S3 bucket with SSE-S3; pre-signed URLs for report downloads; IAM roles scoped least-privilege.
* **Cost**: Bedrock tokens (low, concise outputs), Lambda on-demand, S3 storage cents; fits within **$100 credits**.
* **Limits**: Up to 100 tickers per analysis; API call throttling with backoff + S3 cache.

---

## 14) Risks & Mitigations

* **API rate limits** → cache market data in S3 for 15–60 minutes.
* **Inconsistent sector/beta fields** → standardize provider mappings; fall back to “Unknown”.
* **Over-recommendation** → cap actions to top 3; must include explicit rationale & alternatives.

---

## 15) Implementation Plan (2-day hackathon)

**Day 1**

* Scaffold repo (Infra as CDK or SAM minimal), S3 bucket, API Gateway + Lambda, EventBridge rule.
* Implement tools: `get_market_data`, `compute_metrics`, `write_report`.
* Wire **Bedrock AgentCore** with tool schemas & system prompt.
* CSV upload & JSON validation; first end-to-end analysis.

**Day 2**

* HTML report template + S3 pre-signed URL.
* Autonomous **Daily Check** + manual trigger for demo.
* (Optional) Amazon Q chat + simple web UI.
* Polish copy, add disclaimers, record demo video.

---

## 16) Deliverables

* **Public GitHub repo** with README (setup, env vars, sample CSV).
* **Architecture diagram** (draw.io/Lucid) and this **PRD**.
* **Deployed demo URL** (API endpoint + lightweight web UI).
* **~3-minute demo video** showing upload → analyze → autonomy → report.

---

## 17) Future Enhancements (Post-MVP)

* Brokerage paper-trading (Alpaca) for one-click simulated execution.
* Multi-goal policy (income vs. growth) & tax-lot aware recommendations.
* Guardrails & PII handling with Secrets Manager / Parameter Store.
* Portfolio **what-if** simulator (sliders) and alerting (SNS/Email).

---

## 18) Legal & Ethics

* Display **“This is not financial advice”** prominently in UI and reports.
* Do not collect PII in MVP; keep portfolios as anonymous demo data.

---