<p><img src="brand/docent-logo.svg" alt="Docent" width="260"></p>

Docent is a support agent that software companies embed on their site with one
script tag. Teach it from your documents and it answers your customers with
citations, knows which logged-in user is asking, and hands the conversation to
your team with a summary when it should not answer.

**Status:** planning. Nothing is built yet.

- [Architecture](docs/ARCHITECTURE.md)
- [Build phases](docs/PHASES.md)
- [Brand](brand/README.md)
- [Project rules](CLAUDE.md)

## Stack

FastAPI and Postgres with pgvector on the backend, Next.js for the admin app and
landing page, a small loader script plus iframe for the widget, Redis as an
optional cache, and open models through an OpenAI-compatible client.
