# Project rules

## Product
Name: Docent. Brand assets and usage rules live in brand/README.md.
Multi-tenant AI support agent SaaS. Companies embed a widget with a script tag,
teach the agent from their documents, define their own ticket types, and receive
escalations in an admin inbox with an AI summary.
Wedge: identity-aware support (agent knows the logged-in user via signed tokens)
and predictable usage pricing with hard caps. Change this line if the wedge changes.

## Stack
- Backend: FastAPI (async), Pydantic, Alembic
- Database: Postgres with pgvector, hosted on Neon free tier during build
- Cache and rate limits: Redis on Upstash free tier (optional, must degrade gracefully)
- Frontend: Next.js with TypeScript
- Models: provider-agnostic layer over OpenAI-compatible clients.
  Local dev with Ollama. Never send real customer data through free API tiers.
  Dev chat model: gemma4:cloud (Ollama free plan, synthetic data only). This dev
  machine is an Intel Mac, so local chat models run on CPU and are too slow.
- Embeddings: qwen3-embedding:0.6b via Ollama, truncated to 768 dimensions,
  stored as halfvec(768). Same model in every environment. Changing it means a
  full re-embed.

## Tooling
- Monorepo. JS and TS packages use pnpm workspaces. Python backend uses uv.
- Use pnpm only, never npm or yarn. Use `pnpm dlx` instead of `npx`.
- Add every dependency through the package manager CLI so it resolves and pins
  the version: `pnpm add <pkg>` or `pnpm add -D <pkg>` (with `--filter <workspace>`),
  and `uv add <pkg>` or `uv add --dev <pkg>`. Never hand-write a dependency or
  version into package.json or pyproject.toml and then install.
- Commit lockfiles (pnpm-lock.yaml, uv.lock).
- Local dev uses Docker Compose for Postgres with pgvector and Redis.
  Ollama runs natively on the host (Docker on macOS has no GPU access).
- Secrets live in untracked .env files. Commit only .env.example.

## Architecture rules
- Plain portable Postgres only. No vendor-specific features. Plain SQL via Alembic.
- tenant_id on every tenant table, with row-level security. Tests for every
  tenant-isolation path.
- Durable jobs live in Postgres (FOR UPDATE SKIP LOCKED), not Redis.
- Redis is for rate limits, caching, short-lived state, token revocation only.
  Keep command usage low. Free tier is 500K commands per month.
- Identity: the tenant's server signs a short-lived JWT. Widget holds it in memory
  only. Backend verifies the signature. Never read host cookies or localStorage.
  Server-side actions are scoped to the verified user id, never to chat claims.
- Widget: tiny loader script, iframe, postMessage with strict origin checks,
  per-tenant public key and allowed-domains list.
- Widget has two modes. Anonymous: docs-only answers, tighter caps, tenant can
  turn it off. Identified: tenant-signed token, account-aware answers.
- Agent: retrieval with citations, structured outputs, explicit escalation rules
  (no supporting source, low confidence, user asks for human, restricted topics).
  Treat all visitor input as untrusted (prompt injection).
- Daily pg_dump backup script to free object storage.
- Track token cost per tenant from day one.

## Copy and UI rules
- No em dashes anywhere, in code comments, copy, or docs.
- No shadows, no gradients. Flat surfaces, 1px borders.
- No blue, green, or purple. Palette: warm paper background, near-black ink,
  one rust or vermilion accent.
- Type: Geist for headings and body (chosen 2026-10-14), Geist Mono for code.
  Headings semibold with tight tracking. Consistent spacing and type scale.
- Every clickable element shows a pointer cursor; disabled ones show not-allowed.
- Plain, direct tone. Describe the problem, not the pitch. No invented logos,
  testimonials, or user counts. Say "teach the agent", not "train an LLM".

## Working rules
- Plan first. Do not implement until the plan is approved.
- Build one phase at a time. Stop at the end of each phase for review.