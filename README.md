<p><img src="brand/docent-logo.svg" alt="Docent" width="260"></p>

Docent is a support agent that software companies embed on their site with one
script tag. Teach it from your documents and it answers your customers with
citations, knows which logged-in user is asking, and hands the conversation to
your team with a summary when it should not answer.

**Status:** Phase 1 of 8 (skeleton, auth, tenants, admin shell). See
[build phases](docs/PHASES.md).

- [Architecture](docs/ARCHITECTURE.md)
- [Build phases](docs/PHASES.md)
- [Brand](brand/README.md)
- [Project rules](CLAUDE.md)

## Repository

| Path | What |
|---|---|
| `apps/api` | FastAPI API and job worker (Python 3.14, uv). Alembic migrations. |
| `apps/web` | Next.js admin app (later also the landing page). |
| `packages/api-client` | TypeScript client generated from the API's OpenAPI schema. |
| `infra/db` | Database role bootstrap shared by local Postgres and Neon. |
| `infra/docker` | Production Dockerfiles. |
| `infra/backup` | Encrypted `pg_dump` backups and the restore drill. |
| `scripts` | Repo checks, including the copy and UI rule check. |

## Local development

Requirements: Docker Desktop, Node 24 or newer, [uv](https://docs.astral.sh/uv/),
and from Phase 2 [Ollama](https://ollama.com) running natively.

```bash
corepack enable pnpm   # once per machine (needs corepack 0.34+: npm i -g corepack@latest)
pnpm install
pnpm infra:up          # Postgres 17 + pgvector, Redis, Mailpit
pnpm db:migrate
pnpm dev               # API :8000, worker :8001, web :3000
```

| URL | What |
|---|---|
| http://localhost:3000 | Admin app |
| http://localhost:8000/docs | API reference (local only) |
| http://localhost:8025 | Mailpit, catches every email sent locally |

Run everything in containers instead: `pnpm stack:up` (and `pnpm stack:down`).

### Demo data

```bash
SEED_OWNER_PASSWORD='your password' pnpm seed --owner-email you@example.com
```

Creates two fictional companies (Lumen Notes and Parcelwise) with teammates,
roles, and pending invitations, and makes you owner of one and admin of the
other. Teammates use public `@mailinator.com` inboxes and the password
`docent-demo-password`. Add `--reset` to rebuild from scratch. Local and test
environments only.

No `.env` file is needed locally. Copy `.env.example` to `.env` to change
anything; every variable is documented there.

## Checks

```bash
pnpm test:api      # API tests against real Postgres (RLS, auth, jobs, Redis-down mode)
pnpm e2e           # browser tests (needs pnpm dev running)
pnpm lint          # ruff, eslint, and the copy and UI rule check
pnpm typecheck     # mypy strict and tsc
pnpm api:types     # regenerate the TypeScript client after changing the API
```

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
