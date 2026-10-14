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
| `apps/demo-host` | A pretend customer website for trying the widget, on an allowed and a not-allowed origin. |
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
| http://localhost:5173 | Demo customer site with the widget (`pnpm demo-host`, after the seed) |
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
from scratch. Local and test environments only.

The widget's private signing key is saved to `.data/demo-host/` (git-ignored,
owner-only). Run `pnpm demo-host` and open http://localhost:5173 to chat as an
anonymous visitor or sign in as one of the demo customers.

No `.env` file is needed locally. Copy `.env.example` to `.env` to change
anything; every variable is documented there.

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
