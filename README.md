<p><img src="brand/docent-logo.svg" alt="Docent" width="260"></p>

Docent is a support agent that software companies embed on their site with one
script tag. Teach it from your documents and it answers your customers with
citations, knows which logged-in user is asking, and hands the conversation to
your team with a summary when it should not answer.

**Status:** Phases 1 to 4 and the landing site (Phase 8) are built and waiting
for review: auth and tenants, teaching the agent from documents, cited answers
with handoffs, and the embeddable widget with signed identity. See
[build phases](docs/PHASES.md).

- [Architecture](docs/ARCHITECTURE.md)
- [Build phases](docs/PHASES.md)
- [Brand](brand/README.md)
- [Project rules](CLAUDE.md)

## Repository

| Path | What |
|---|---|
| `apps/api` | FastAPI API and job worker (Python 3.14, uv). Alembic migrations. |
| `apps/web` | Next.js landing site (`/`) and admin app (`/app`). |
| `apps/widget` | The embeddable widget: `loader.js` for customer sites and the chat frame. Served by the API. |
| `apps/demo-host` | The live showcase: two fictional customer sites with the widget installed, on an allowed and a not-allowed origin. |
| `packages/api-client` | TypeScript client generated from the API's OpenAPI schema. |
| `examples/signing` | Identity token signing in Node, Python, Ruby, PHP, and Go, verified against the API. |
| `fixtures` | Golden help centers and questions for retrieval and agent evals. |
| `infra/db` | Database role bootstrap shared by local Postgres and Neon. |
| `infra/docker` | Production Dockerfiles. |
| `infra/backup` | Encrypted `pg_dump` backups and the restore drill. |
| `scripts` | Repo checks, including the copy and UI rule check. |

## Local development

Requirements: Docker Desktop, Node 24 or newer, [uv](https://docs.astral.sh/uv/),
and [Ollama](https://ollama.com) running natively.

```bash
corepack enable pnpm   # once per machine (needs corepack 0.34+: npm i -g corepack@latest)
pnpm install
ollama pull embeddinggemma
ollama signin          # once; the chat model gemma4:cloud runs through the local Ollama
pnpm infra:up          # Postgres 17 + pgvector, Redis, Mailpit
pnpm db:migrate
pnpm --filter @docent/widget build   # the API serves the widget from apps/widget/dist
pnpm dev               # API :8000, worker :8001, web :3000
```

| URL | What |
|---|---|
| http://localhost:3000 | Landing site |
| http://localhost:3000/app | Admin app |
| http://localhost:3000/admin | Platform admin console, for Docent's own operators (see below) |
| http://localhost:5173 | Live showcase: Lumen Notes and Parcelwise with the widget (`pnpm demo-host`, after the seed) |
| http://localhost:8000/docs | API reference (local only) |
| http://localhost:8025 | Mailpit, catches every email sent locally |

The chat model is `gemma4:cloud`, served through the local Ollama after
`ollama signin` (synthetic and demo data only on the free plan). To work fully
offline, `ollama pull qwen3:1.7b` and set `LLM_MODEL=qwen3:1.7b` in `.env`; it
runs on a laptop CPU but answers slowly (10 to 50 seconds) and less accurately.

Run everything in containers instead: `pnpm stack:up` (and `pnpm stack:down`).

### Demo data

```bash
SEED_OWNER_PASSWORD='your password' pnpm seed --owner-email you@example.com
```

Four fictional companies cover every plan state, and your account has a
different role in each, so one login shows the owner, admin, and agent views:

| Workspace | Plan | You are | Teammates (password `Docent@123`) |
|---|---|---|---|
| Lumen Notes | Growth, active | owner | Maya Chen (admin), Omar Haddad and Priya Nair (agents) |
| Parcelwise | Scale, active | admin | Lucas Martin (owner), Sofia Rossi and Kenji Watanabe (agents) |
| Tallyfox | Starter, payment failed, in its grace period | agent | Nina Okafor (owner), Daniel Weber (admin) |
| Fernway Studio | Trial, 9 days left, empty | owner | a pending invitation |

Teammates sign in as `docent-<first>.<last>@mailinator.com`, for example
`docent-maya.chen@mailinator.com`. Set `SEED_DEMO_PASSWORD` to use a different
password.

With the API and worker running, the seed also teaches each company's agent
from its help center (`fixtures/golden` and `fixtures/demo`), adds ticket types
and team answers, installs a widget on the demo host, and then has about 40
customer conversations with the real agent: answers with citations, small talk,
off-topic questions, handoffs with summaries, signed-in customers and anonymous
visitors. Those are spread over the past month, handoffs are mostly resolved,
earlier months get usage history, and signed-in customers get their memory.
This takes a few minutes; `--no-conversations` skips it. `--reset` rebuilds
from scratch. Local and test environments only. Your account is also made a
platform admin, so http://localhost:3000/admin opens for it.

Each widget's private signing key is saved to `.data/demo-host/` (git-ignored,
owner-only). Parcelwise's widget has anonymous chat turned off; the others allow
it. Rerunning the seed puts each widget's anonymous setting, claims, and greeting
back to the catalog.

### Live showcase

`pnpm demo-host` serves two sites we built to show the widget working, linked
from "See it live" on the landing page:

| URL | Site | Widget |
|---|---|---|
| http://localhost:5173/lumen-notes | Lumen Notes, a notes app's public site and help center. The help articles are the ones the agent was taught (`fixtures/golden/lumen-notes`). | Anonymous for every visitor: cited answers, and a handoff that asks for an email. |
| http://localhost:5173/parcelwise | Parcelwise, a shipping dashboard. Signed out, only a sign-in page with the demo customers Chloe Dubois (Scale), Diego Ramos (Starter), and Emma Wright (Growth), and no chat. | Identified only. The site's server signs a token with the customer's plan, so "What's my per-label fee?" is answered from that plan. Sign-out calls `await Docent.reset()` first. |

Both have a "Try asking" panel: a click copies the question and opens the chat
(the loader cannot type into the chat, and a host page never reaches into the
widget's frame). The token's `sub` is the demo customer's id, so the agent
remembers the customer across chats, and its `ctx` carries the figures on the
dashboard (postage balance, auto-reload, labels this month), so "What's my
balance?" is answered from them. On a public deployment, where many visitors
share each demo customer, set `SHOWCASE_PRIVATE_CHATS=1`: the `sub` then adds a
random id per browser, so a visitor resumes only their own chat. The same pages on http://localhost:5174 are on an
origin the widgets do not allow, so the browser refuses to show the chat there.
`DOCENT_URL` sets the "About Docent" link (default http://localhost:3000).

On a deployed landing page, point the buttons at the hosted showcase with
`NEXT_PUBLIC_SHOWCASE_PUBLIC_URL` and `NEXT_PUBLIC_SHOWCASE_APP_URL` (see
`.env.example`). The Tallyfox workspace stays in the seed but has no site here.

### Payments

Without Stripe keys every workspace runs on its trial or a manual plan, and the
billing page says payments are not set up. To try real checkout in test mode:

1. Put a test secret key (`sk_test_...`) in `.env` as `STRIPE_SECRET_KEY`.
2. `pnpm stripe:sync` creates the three plans as Stripe products and prices.
3. `docker compose --profile app --profile stripe up -d`, then
   `docker compose logs stripe` prints the webhook signing secret. Put it in
   `.env` as `STRIPE_WEBHOOK_SECRET` and restart the API.
4. Choose a plan on the billing page and pay with card `4242 4242 4242 4242`.

Plan changes, cancellation, and refunds then work from the billing page. Each
change opens a preview first: an upgrade shows today's prorated charge line by
line, a downgrade starts at the end of the paid period, a cancellation keeps
the plan until then, and the 14 day money-back guarantee refunds everything
paid. The rules are in `docs/ARCHITECTURE.md`, section 10.

No `.env` file is needed locally. Copy `.env.example` to `.env` to change
anything; every variable is documented there.

### Platform admin console

`/admin` is Docent's own console across every workspace: revenue, model cost
and margin, cost-per-reply anomalies, each workspace's plan and usage, people,
the job queue, and Stripe events. It shows counts and metadata only, never
conversations, knowledge content, or customer memory. To open it, make your
account a platform admin from the command line (no screen can do this), then
sign in with a verified email and choose "Platform admin" in the account menu:

```bash
pnpm admin grant you@example.com    # uses DATABASE_URL, like the API
pnpm admin revoke you@example.com   # takes effect on the next request
```

Anyone else, signed in or not, gets the ordinary "page does not exist" answer
from both `/admin` and the API under `/v1/admin`. From a workspace's page you
can extend a trial by 1 to 30 days, give a paid plan at no charge until a date
(a comp), or end a comp. Each one asks for a reason and is written to that
workspace's audit log, as is every opening of the page. Workspaces that pay
through Stripe are changed only through Stripe. The access model is in
`docs/ARCHITECTURE.md`, section 12.

## Checks

```bash
pnpm test:api      # API tests against real Postgres (RLS, auth, jobs, Redis-down mode)
pnpm e2e           # browser tests (needs pnpm dev running)
pnpm lint          # ruff, eslint, and the copy and UI rule check
pnpm typecheck     # mypy strict and tsc
pnpm api:types     # regenerate the TypeScript client after changing the API
bash examples/signing/verify.sh   # every signing example against the local API
```

After editing `examples/signing`, run `node scripts/gen-signing-examples.mjs` so
the install guide shows the same code; CI fails when they differ.

### Quality evals

```bash
pnpm eval:retrieval   # recall and ranking on the golden questions
pnpm eval:agent       # answers, handoffs, and safety cases with the real model
```

Evals use their own database, `docent_eval`, so they never touch demo data.
Migrate it once with
`MIGRATION_DATABASE_URL=postgresql://docent_owner:docent_owner@127.0.0.1:5432/docent_eval pnpm db:migrate`.
A Postgres volume created before the eval database existed needs it created
first: `docker compose exec postgres psql -U postgres -c "create database docent_eval owner docent_owner"`,
then `docker compose exec -T postgres psql -U postgres -d docent_eval < infra/db/sql/database.sql`.

## Dependencies

Add packages only through the package manager so versions are resolved and
locked: `pnpm --filter <package> add <name>` for TypeScript, and
`uv add <name>` inside `apps/api` for Python. Never edit versions by hand.

## Backups

```bash
pnpm backup:keygen          # creates an age key pair; keep the private key offline
pnpm backup                 # dump, encrypt, store locally, upload if S3 is configured
pnpm backup:restore-drill   # restore the latest dump into a throwaway Postgres and verify it
```
