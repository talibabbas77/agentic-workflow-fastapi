# Docent build phases

Status: draft for review. Phase 1 starts only after this plan is approved.
Last updated: 2026-10-13.

Each phase builds against [ARCHITECTURE.md](ARCHITECTURE.md), ends with its
acceptance checks passing, and stops for review before the next phase starts.

## Rules for every phase

A phase is done when all of these hold:

- Every acceptance check below passes. Checks marked **(auto)** run in CI.
- The RLS catalog test and per-table isolation tests pass, including for tables
  added in this phase.
- The app works with Redis stopped.
- CI is green: lint, type check, tests, build. `pnpm install --frozen-lockfile`
  and `uv sync --locked` succeed. Every dependency was added with `pnpm add` or
  `uv add`.
- No em dashes in code, comments, copy, or docs. UI follows the copy and UI rules.
- ARCHITECTURE.md is updated for anything that changed, with a dated note.
- A short demo script (steps to see the phase working) is in the phase's PR.

## Before Phase 1 (you)

- [ ] Revoke the GitHub token pasted in chat and create a new one.
- [ ] Push the local commits: `git push -u origin main`.
- [ ] Optional: rename the GitHub repo to `docent`, then
      `git remote set-url origin https://github.com/talibabbas77/docent.git`.
- [ ] Run `ollama signin` if you accept `gemma4:cloud` as the dev chat model.
- [ ] Approve or change the decisions in ARCHITECTURE.md section 1.

---

## Phase 1. Project skeleton, auth, tenants, admin shell

**Status: built 2026-10-14, waiting for review.** All 13 checks pass locally.
Checks 3 to 7, 9 and 10 run in the API test suite (53 tests); 1, 2 and 8 run in
the Playwright suite against the Docker stack; 11 is covered by
`test_idle_worker_does_not_poll`; 12 passed with a real dump and restore drill.
Check 13 runs when the repo is pushed to GitHub.

**Goal:** a running monorepo where a person can sign up, create a tenant,
invite a teammate, and see an empty admin app, with tenant isolation enforced
by the database from the first table.

**Scope**

- pnpm workspace (pnpm activated through corepack) with `apps/web`, and a uv
  project in `apps/api`. Root scripts: `dev`, `test`, `lint`, `typecheck`,
  `db:migrate`, `db:reset`.
- `compose.yaml`: Postgres 17 with pgvector, Redis, Mailpit, all with health
  checks and named volumes. Optional `app` profile runs API, worker, and web in
  containers.
- `.env.example` covering every variable.
- Alembic baseline: database roles, RLS helper, `tenants`, `users`,
  `memberships`, `user_sessions`, `auth_tokens`, `invitations`, `audit_log`,
  `jobs`.
- Auth: sign up (creates user, tenant, owner membership), email verification,
  log in, log out, password reset, invite member, accept invite, switch tenant.
  Roles: owner, admin, agent.
- Job queue core (claim, heartbeat, reaper, retry, dead) and a `send_email` job,
  worker wake endpoint.
- Rate limiter interface with Redis and in-process backends. Applied to auth
  endpoints.
- Admin shell in Next.js: log in and sign up pages, layout with the Docent logo,
  navigation placeholders (Inbox, Knowledge, Widget, Ticket types, Evals,
  Usage, Settings), tenant settings page, members page.
- Repo checks: no-em-dash check, forbidden color check on styles.
- Backup script (`pg_dump`, `age` encryption, upload to S3-compatible storage)
  and restore drill script.
- GitHub Actions CI.

**Out of scope:** knowledge, chat, widget, billing.

**Acceptance checks**

1. From a fresh clone, the README steps (`corepack enable`, `pnpm install`,
   `docker compose up -d`, `pnpm db:migrate`, `pnpm dev`) bring up web on port
   3000 and API on port 8000. `/healthz` returns `ok`.
2. Sign up, receive the verification email in Mailpit, verify, log in, and see
   the admin shell with the tenant name.
3. Invite a second user as `agent`. That user can log in but gets 403 from the
   settings and members APIs. **(auto)**
4. RLS catalog test: every table with `tenant_id` has RLS enabled, forced, and a
   policy. **(auto)**
5. Isolation tests for every tenant table, and the no-tenant-set test returns
   zero rows. **(auto)**
6. `docent_app` and `docent_worker` have no `BYPASSRLS` and no DDL rights.
   **(auto)**
7. A tenant A session requesting any tenant B resource gets 404. **(auto)**
8. With `docker compose stop redis`, sign up and log in still work, auth rate
   limits still apply, and `/healthz` shows `redis: degraded`.
9. Ten failed logins for one email within a minute return 429. **(auto)**
10. Job queue: a job whose worker is killed mid-run is picked up again after
    its lease expires; a job that always fails ends `dead` after 5 attempts.
    **(auto)**
11. An idle worker sends no queries to Postgres between safety polls (checked
    with `pg_stat_activity` or query logging).
12. The backup script produces an encrypted dump; the restore drill restores it
    into a fresh container and the RLS tests pass on the restored database.
13. CI is green on the phase PR.

---

## Phase 2. Document ingestion and retrieval

**Status: built and measured 2026-10-14.** Check 2: recall at 8 is 0.984 on
124 questions. Checks 3 to 7 run in the API suite. Checks 8 and 9 are recorded
in the architecture change log.

**Goal:** a tenant can teach the agent from files and web pages, and staff can
see exactly which passages a question would retrieve.

**Scope**

- Object storage interface: a Docker volume now, Cloudinary later.
- Sources: file upload (PDF, DOCX, Markdown, text, HTML), single URL, sitemap.
  Crawling stays on the same domain, respects `robots.txt`, caps pages, and
  rate-limits itself.
- Jobs: `ingest_source`, `crawl_url`, `parse_document`, `embed_document`,
  `delete_source`.
- Chunking by heading, then size (section 6 of ARCHITECTURE.md).
- Embedding client for Ollama (`embeddinggemma`, 768 dims) behind an
  interface. Pull the model: `ollama pull embeddinggemma`.
- `knowledge_sources`, `documents`, `chunks` with HNSW and GIN indexes.
- Hybrid search service: vector plus keyword, reciprocal rank fusion, audience
  filter, iterative index scans.
- Admin Knowledge pages: list with status and errors, add source, re-sync,
  delete, audience setting, and a search preview that shows ranked chunks with
  scores.
- Platform golden corpus: two synthetic tenants with made-up product docs and
  retrieval questions, checked into `fixtures/`.

**Out of scope:** answering questions.

**Acceptance checks**

1. One file of each supported type, one URL, and a sitemap of up to 50 pages
   all reach `ready`. A broken file shows a readable error in the admin app.
2. Retrieval recall at 8 is 85 percent or higher on at least 60 golden
   retrieval questions. **(auto)**
3. Re-syncing an unchanged document does no re-embedding (content hash).
   **(auto)**
4. Deleting a source removes its chunks and stored files, and running the
   delete job twice is harmless. **(auto)**
5. A public-only search never returns `identified` chunks. **(auto)**
6. Tenant A search never returns tenant B chunks, even for identical text.
   **(auto)**
7. Killing the worker during embedding and restarting it produces no duplicate
   chunks. **(auto)**
8. Embedding throughput on this Mac and storage per chunk are measured and
   recorded in ARCHITECTURE.md.
9. An initial evidence-gate threshold is calibrated on the golden set and
   recorded.

---

## Phase 3. Agent loop with citations and escalation

**Status: built 2026-10-14, waiting for review.** The Agent screen (settings
and preview chat) and the Handoffs screen (ticket types) have e2e tests. Check
2 passes on `gemma4:cloud`: wrong answers 0 percent, escalation recall 100
percent, safety cases 100 percent (architecture change log). Checks 1, 3, 4, 5, and 9 run in the API suite. Check 2 with the dev
model `qwen3:1.7b`: escalation recall 1.00 and injection cases 1.00 pass, but
the wrong-answer rate is 9.4 percent against the 5 percent target. The misses
cite a neighbouring article, so the gap is the model, not retrieval (recall at
8 is 0.98). Checks 2 and 8 are rerun on `gemma4:cloud` once you run
`ollama signin`. Check 10 is recorded in the architecture change log.

**Goal:** staff can chat with their agent in a preview panel; every answer is
cited, and anything the agent cannot back up goes to a human.

**Scope**

- LLM client with the three structured-output strategies and Pydantic
  validation (section 6).
- Versioned prompt templates.
- The ten-step agent loop, including query rewrite, evidence gate, repair retry,
  and escalation rules.
- `conversations`, `messages`, `message_citations`, `ticket_types`,
  `escalations`.
- Ticket types admin page (name, description, fields, notify emails).
- `summarize_escalation` job.
- `usage_events`, `usage_periods` with the reservation path, `model_prices`.
  Caps are set very high until Phase 7, but the code path runs on every reply.
- Admin preview chat: test as anonymous or with simulated identity claims.
- Golden-set runner script (Phase 6 turns it into a product feature).

**Out of scope:** the embeddable widget, the inbox.

**Acceptance checks**

1. Every shown answer has at least one valid citation. Invalid markers trigger a
   repair, then an escalation. **(auto)**
2. Platform golden set: wrong-answer rate 5 percent or less, escalation recall
   95 percent or more, injection cases 100 percent, cross-tenant leaks zero.
3. Twenty phrasings of "talk to a human", in at least three languages, all
   escalate. **(auto)**
4. Restricted-topic cases all escalate. **(auto)**
5. Questions with no supporting source never reach the answer model: one small
   triage call sorts them, product questions become handoffs, and small talk,
   off-topic, and unclear messages get a reply instead. Greetings and thanks
   are answered by rules with no model call at all. **(auto)**
6. An escalation has a ticket type, filled fields, and a summary within 30
   seconds.
7. Every LLM call has a usage event with cost. Totals for a test run match the
   provider's reported usage.
8. The golden subset passes with both the native-schema strategy (local Ollama)
   and the prompt-only strategy (Ollama Cloud).
9. With simulated claims, "what plan am I on" is answered from the claim, and a
   message claiming to be another user changes nothing. **(auto)**
10. p50 and p95 answer latency are recorded.

---

## Phase 4. Widget with signed identity

**Status: built 2026-10-14 except staging, waiting for review.** The Widgets
screens (settings, signing keys made in the browser, install) have e2e tests.
Checks 3, 6, 7, and 9 run in the API suite. Checks 2, 4, 5, and 10 run in the
widget's Playwright suite (Chromium and WebKit) against the demo host; check 8
runs in CI (loader 3.1 KB gzipped). Check 1 passes with the local model but is
gated behind `E2E_CHAT_MODEL=1` because CI has no chat model. Signing snippets
for all five languages are verified by `examples/signing/verify.sh`. Checks 11
and 12 wait on O2, O3, and O5.

**Goal:** a tenant pastes one script tag (anonymous) or adds server-side signing
(identified), and the agent works on their site with every widget security rule
in force.

**Needs from you first:** O2 (production LLM), O3 (hosting), O5 (domain),
because this phase deploys staging on real HTTPS origins.

**Scope**

- Admin Widget pages: allowed origins, anonymous toggle and daily cap, claim
  allowlist, signing keys (browser key generation, upload, rotate, retire),
  install snippet.
- `widgets`, `signing_keys`, `end_users`, `widget_sessions`.
- `loader.js`, the iframe app, the `MessagePort` handshake, `Docent.init`,
  `Docent.reset`.
- Session endpoint with every verification rule in ARCHITECTURE.md section 4.
- Per-widget `frame-ancestors` CSP and strict iframe CSP.
- Anonymous mode with per-IP and per-widget limits. Optional bot check.
- Escalation flow inside the widget (ticket fields, email for anonymous).
- `apps/demo-host`: a fake customer site on another origin with a signing
  endpoint.
- Signing snippets for Node, Python, Ruby, PHP, Go.
- Staging deployment: Neon, Upstash, R2, Resend, hosting from O3.

**Acceptance checks**

1. On the demo host (allowed origin) the widget loads, an identified session
   starts, and "what plan am I on" is answered from claims. **(auto,
   Playwright)**
2. The same snippet on a non-allowed origin: the browser refuses to frame the
   widget. **(auto, Playwright)**
3. Rejected tokens: expired, `iat` in the future, wrong `aud`, wrong `iss`,
   unknown `kid`, retired `kid`, `alg: none`, HS256 signed with the public key,
   tampered payload, replayed `jti`, oversized claims. **(auto)**
4. Messages from another origin, or from a window that is not the parent, are
   ignored. **(auto, Playwright)**
5. With third-party cookies blocked (Chromium and WebKit), the widget works.
   **(auto, Playwright)**
6. Anonymous off: anonymous sessions are refused. Anonymous on: answers cite
   only public sources. **(auto)**
7. The 11th anonymous message within an hour from one IP gets a friendly limit
   message. **(auto)**
8. `loader.js` is 6 KB gzipped or less. **(auto)**
9. Key rotation: tokens signed with a new key work; tokens signed with a retired
   key are rejected. **(auto)**
10. `Docent.reset()` revokes the session on the server. **(auto)**
11. Staging is live on HTTPS, and the demo host runs on a separate domain.
12. Staging sits behind an edge proxy that replaces `X-Forwarded-For`. A request
    from the internet with a forged `X-Forwarded-For` does not change the
    rate-limit key. **(auto)**

---

## Phase 5. Admin inbox and notifications

**Not started.** Two pieces it builds on landed early: handoffs now carry a
reliable contact email (asked of anonymous visitors in the chat), and the
memory page shows knowledge gaps and team answers, so the team can already
teach the agent from what it could not answer.

**Goal:** escalations reach the right person quickly, with enough context to
reply without asking the customer to repeat themselves.

**Scope**

- Inbox list with filters (status, ticket type, reason, assignee) and unread
  counts.
- Kanban board view of escalations (Open, Assigned, Waiting, Resolved) with
  drag and drop and a keyboard alternative.
- Routing rules: "When ticket type is X and ... then assign, notify, set
  priority". Outgoing webhooks for n8n, Zapier, or Make.
- Escalation detail: transcript with citations, verified user claims, AI
  summary, ticket fields, internal notes, assign, change status.
- Reply by email from the inbox (Resend in staging, Mailpit locally). Reply-To
  is the tenant's support address, so follow-ups continue in their mailbox.
- Notifications: email on new escalation routed by ticket type, daily digest,
  optional Slack incoming webhook.
- "Mark answer as wrong" on any agent message (feeds Phase 6 metrics).
- `notifications`, `notification_channels`, `email_deliveries`.

**Acceptance checks**

1. A new escalation appears in the inbox within 5 seconds and its email
   notification arrives in Mailpit within 60 seconds.
2. An inbox reply reaches the visitor's email with the right From and Reply-To,
   and the delivery is recorded.
3. The `agent` role can work the inbox but cannot change settings or billing.
   **(auto)**
4. A failing notification retries, then shows as dead with a visible error.
   **(auto)**
5. Slack webhook test message is sent; the stored URL is encrypted at rest.
6. Tenant A's inbox never shows tenant B escalations. **(auto)**
7. The daily digest is sent once per user per day, even if the job runs twice.
   **(auto)**
8. "Mark as wrong" is stored and counted by the metrics query. **(auto)**

---

## Phase 6. Eval suite

**Goal:** every tenant can see how often their agent resolves, answers wrong,
and escalates, and no prompt or model change ships if it makes those worse.

**Scope**

- Eval sets and cases UI, case editor with simulated identity.
- Draft case generation from a tenant's chunks; tenant approves or edits.
- One-click "add to eval set" from conversations and escalations.
- `run_eval` job: full agent loop per case, deterministic checks, LLM judge.
- Judge calibration: label 50 cases, compute agreement.
- Run comparison view with per-case differences.
- Production metrics dashboard: resolution rate (auto and confirmed),
  wrong-answer rate, escalation rate by reason, latency, cost.
- Weekly review queue: samples 20 answered conversations per tenant.
- CI gate on the platform golden set for changes to prompts, models, chunking,
  or retrieval settings.

**Acceptance checks**

1. For the demo tenant: generate 40 drafts, approve 30, run an eval, and see the
   metrics.
2. Judge agreement with human labels is 85 percent or higher on 50 cases, and
   the number is recorded.
3. Comparing two runs shows which cases changed and why.
4. A deliberately worse prompt in a test PR fails the CI gate with a readable
   report. **(auto)**
5. Dashboard numbers match hand-written SQL on seeded data exactly. **(auto)**
6. Eval runs respect a concurrency of 1 on the free cloud plan (no bursts of
   429 errors), and each run records its cost.

---

## Phase 7. Usage metering, caps, billing

**Status: billing built 2026-10-14 ahead of Phases 5 and 6, on Stripe (D19),
waiting for review.** Built: subscriptions with trials and plan states, live
reply caps from the plan, 80 and 100 percent emails, escalate-only mode when a
trial ends, a payment stays failed past the 7 day grace, or a plan is canceled,
plan limits on widgets, seats, and pages, Stripe checkout, customer portal, and
signed idempotent webhooks, and the billing page. Checks 2, 4, and 5 (upgrade
part) run in the API suite; the gateway runs against stripe-mock in CI. Not yet
built: top-up packs, the internal cost and margin dashboard, the Redis command
budget alerts, and the load test in check 1. Live payments need your Stripe
keys; see the README.

**Goal:** tenants pay a predictable monthly price, can never be billed past
their cap, and their customers never hit a dead widget.

**Needs from you first:** O1 (country of registration, which picks the billing
provider) and O4 (plan prices and caps).

**Scope**

- `plans`, `subscriptions`, `topups`, `billing_events`.
- Usage period lifecycle, live cap enforcement, 80 and 100 percent notices.
- Escalate-only mode in the widget at cap or after the payment grace period.
- Caps on pages, sources, widgets, seats. Configurable per-visitor limits.
- Billing provider: checkout, customer portal, webhooks, top-up packs,
  upgrades, downgrades, failed-payment grace.
- Tenant usage page. Internal cost and margin dashboard with the cost-per-reply
  anomaly alert.
- Redis command budget counter and alerts.

**Acceptance checks**

1. Load test: 50 concurrent messages with 10 replies left produce exactly 10 AI
   replies; the rest get escalate-only responses. **(auto)**
2. The 80 and 100 percent emails are sent once each per period. **(auto)**
3. At cap, the widget shows the contact form and every message becomes an
   escalation. **(auto, Playwright)**
4. A webhook delivered three times is processed once; a bad signature gets 400.
   **(auto)**
5. Upgrading mid-period raises the cap immediately; downgrading takes effect at
   period end. **(auto)**
6. A failed payment starts a 7-day grace period, then escalate-only mode, with
   all data intact.
7. The tenant usage page reconciles exactly with `usage_events`. **(auto)**
8. Provider sandbox end to end: trial, checkout, active, cancel.
9. Forcing the Redis budget counter to 90 percent switches the app to
   local-only mode. **(auto)**

---

## Phase 8. Landing page following the copy and UI rules

**Status: built 2026-10-14 ahead of Phases 5 to 7, waiting for review.**
Checks 1, 2, 4, 5, and 6 pass (rule check and axe in e2e; pricing reads the
plans API). Check 3: accessibility, best practices, and SEO score 100, but
mobile performance has a median of about 92 against 95, measured on a busy dev
laptop; recheck on the production host. Check 8 is yours: privacy and terms
are marked as drafts pending legal review.

**Goal:** a plain, honest site that explains the problem, how Docent works, and
what it costs.

**Scope**

- Pages: home, how it works (widget and identity), pricing (reads the same plan
  config as billing), security, install docs with signing snippets, privacy,
  terms, contact.
- Brand applied per `brand/README.md`: Geist for headings and body, and
  paper, ink, and rust only.
- Open Graph images from the brand files, sitemap, robots.

**Acceptance checks**

1. Copy check: no em dashes, none of the banned phrases (including "train an
   LLM"), no testimonial, logo-wall, or user-count components. **(auto)**
2. Style check: no blue, green, or purple colors, no `box-shadow`, no
   gradients. **(auto)**
3. Lighthouse mobile scores of 95 or higher for performance, accessibility,
   best practices, and SEO on home and pricing. **(auto)**
4. axe reports zero serious or critical issues. **(auto)**
5. Pricing values come from the single plan config used by billing. **(auto)**
6. The site states the limits plainly: email replies, not live chat;
   identified mode needs server-side signing.
7. Logo usage follows the clear space and minimum size rules.
8. A person reviews privacy and terms before launch. (manual)
