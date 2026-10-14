"""Evals: test sets and cases, eval runs and their results, the weekly review queue.

- eval_sets: a named group of test questions. Drafting columns track the job
  that writes draft cases from the workspace's own help articles.
- eval_cases: one test question with what should happen: the visitor's
  question, optional earlier turns, a simulated identity (null for an anonymous
  visitor, or the claims of a signed-in customer), the expected outcome
  (answer, escalate, or clarify), phrases a reply must or must not contain, the
  gold documents (and, for generated cases, the exact passage), and tags.
  Drafts (status draft) are generated cases nobody has approved yet; runs skip
  them. A case made from a conversation keeps a link to it.
- eval_runs: one run of a set through the full agent loop, with the settings it
  ran with (model, prompt versions, retrieval settings, knowledge version) and
  its metrics. A partial unique index allows one queued or running run per
  workspace, so runs go one at a time.
- eval_results: one case in one run. The case is copied as it ran, so a later
  edit or delete does not rewrite history. Keeps the reply, what retrieval
  found, each deterministic check, the verdict, the judge's verdict and reason,
  cost, and latency. label is a person's verdict on the judge's call, for
  calibration.
- review_items: the weekly review queue. Up to 20 answered widget
  conversations per workspace per week, each with the answer to grade and the
  grade. A conversation is sampled once, ever.

Revision ID: 0012
Revises: 0011
Create Date: 2026-10-14
"""

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None

NEW_TABLES = ("eval_sets", "eval_cases", "eval_runs", "eval_results", "review_items")

VERDICTS = (
    "'correct', 'wrong', 'unsupported', 'escalated_correctly', 'escalated_wrongly', "
    "'missed', 'error'"
)


def upgrade() -> None:
    op.execute(
        f"""
        create table eval_sets (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          name             text not null check (char_length(name) between 1 and 80),
          description      text not null default '' check (char_length(description) <= 500),
          draft_status     text not null default 'idle'
                           check (draft_status in ('idle', 'running', 'failed')),
          draft_requested  int not null default 0,
          draft_written    int not null default 0,
          draft_skipped    int not null default 0,
          draft_error      text,
          created_by       uuid references users (id) on delete set null,
          created_at       timestamptz not null default now(),
          updated_at       timestamptz not null default now()
        );
        create unique index eval_sets_name_key on eval_sets (tenant_id, lower(name));

        create table eval_cases (
          id                      uuid primary key,
          tenant_id               uuid not null references tenants (id) on delete cascade,
          set_id                  uuid not null references eval_sets (id) on delete cascade,
          status                  text not null default 'active'
                                  check (status in ('draft', 'active')),
          question                text not null check (char_length(question) between 1 and 2000),
          history                 jsonb not null default '[]',
          identity                jsonb,
          expected                text not null
                                  check (expected in ('answer', 'escalate', 'clarify')),
          reference_answer        text not null default ''
                                  check (char_length(reference_answer) <= 2000),
          must_include            text[] not null default '{{}}',
          must_not_include        text[] not null default '{{}}',
          gold_document_ids       uuid[] not null default '{{}}',
          gold_chunk_ids          uuid[] not null default '{{}}',
          tags                    text[] not null default '{{}}',
          origin                  text not null
                                  check (origin in ('manual', 'generated', 'conversation')),
          source_conversation_id  uuid references conversations (id) on delete set null,
          source_message_id       uuid references messages (id) on delete set null,
          created_by              uuid references users (id) on delete set null,
          created_at              timestamptz not null default now(),
          updated_at              timestamptz not null default now()
        );
        create index eval_cases_set_idx on eval_cases (tenant_id, set_id, status, created_at);

        create table eval_runs (
          id           uuid primary key,
          tenant_id    uuid not null references tenants (id) on delete cascade,
          set_id       uuid not null references eval_sets (id) on delete cascade,
          status       text not null default 'queued'
                       check (status in ('queued', 'running', 'succeeded', 'failed', 'canceled')),
          config       jsonb not null default '{{}}',
          metrics      jsonb,
          case_count   int not null default 0,
          done_count   int not null default 0,
          cost_micros  bigint not null default 0,
          error        text,
          created_by   uuid references users (id) on delete set null,
          created_at   timestamptz not null default now(),
          started_at   timestamptz,
          finished_at  timestamptz
        );
        create index eval_runs_set_idx on eval_runs (tenant_id, set_id, created_at desc);
        create index eval_runs_tenant_idx on eval_runs (tenant_id, created_at desc);
        -- One run at a time per workspace: no bursts against a rate-limited model.
        create unique index eval_runs_one_active on eval_runs (tenant_id)
          where status in ('queued', 'running');

        create table eval_results (
          id             uuid primary key,
          tenant_id      uuid not null references tenants (id) on delete cascade,
          run_id         uuid not null references eval_runs (id) on delete cascade,
          case_id        uuid references eval_cases (id) on delete set null,
          position       int not null,
          question       text not null,
          expected       text not null check (expected in ('answer', 'escalate', 'clarify')),
          case_snapshot  jsonb not null default '{{}}',
          output         jsonb not null default '{{}}',
          retrieved      jsonb not null default '[]',
          checks         jsonb not null default '[]',
          verdict        text not null check (verdict in ({VERDICTS})),
          judge_verdict  text check (judge_verdict in ('correct', 'wrong', 'unsupported')),
          judge_notes    text,
          tokens_in      int not null default 0,
          tokens_out     int not null default 0,
          cost_micros    bigint not null default 0,
          latency_ms     int not null default 0,
          label          text check (label in ('right', 'wrong')),
          labeled_by     uuid references users (id) on delete set null,
          labeled_at     timestamptz,
          created_at     timestamptz not null default now(),
          unique (run_id, case_id)
        );
        create index eval_results_run_idx on eval_results (tenant_id, run_id, position);
        create index eval_results_labeled_idx on eval_results (tenant_id, labeled_at desc)
          where label is not null;

        create table review_items (
          id               uuid primary key,
          tenant_id        uuid not null references tenants (id) on delete cascade,
          week_start       date not null,
          conversation_id  uuid not null references conversations (id) on delete cascade,
          message_id       uuid not null references messages (id) on delete cascade,
          grade            text check (grade in ('right', 'wrong')),
          note             text not null default '' check (char_length(note) <= 1000),
          flagged_answer   boolean not null default false,
          graded_by        uuid references users (id) on delete set null,
          graded_at        timestamptz,
          sampled_at       timestamptz not null default now(),
          unique (tenant_id, conversation_id)
        );
        create index review_items_week_idx on review_items (tenant_id, week_start, sampled_at);
        """
    )
    for table in NEW_TABLES:
        op.execute(
            f"""
            alter table {table} enable row level security;
            alter table {table} force row level security;
            create policy tenant_isolation on {table}
              using (tenant_id = app_current_tenant())
              with check (tenant_id = app_current_tenant());
            """
        )
    op.execute(
        """
        grant select, insert, update, delete on eval_sets, eval_cases to docent_app;
        grant select, insert, update on eval_runs, review_items to docent_app;
        -- The app reads results and records a person's label; the worker writes them.
        grant select on eval_results to docent_app;
        grant update (label, labeled_by, labeled_at) on eval_results to docent_app;

        -- The worker writes draft cases and runs evals.
        grant select, update on eval_sets, eval_runs to docent_worker;
        grant select, insert on eval_cases, eval_results to docent_worker;
        """
    )


def downgrade() -> None:
    op.execute(
        """
        drop table if exists review_items, eval_results, eval_runs, eval_cases, eval_sets;
        """
    )
