"""Widget suggestions: short questions the widget offers before the first message.

- widgets.suggestions: up to 4 questions, shown under the greeting while a
  conversation has no messages. A click sends the question as the visitor's
  message. The API trims them, caps each at 100 characters, and refuses
  duplicates; the database keeps the count and the length as a backstop.

Revision ID: 0010
Revises: 0009
Create Date: 2026-10-14
"""

from alembic import op

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        """
        alter table widgets
          add column suggestions text[] not null default '{}',
          add constraint widgets_suggestions_check check (
            cardinality(suggestions) <= 4
            and array_position(suggestions, null) is null
            and char_length(array_to_string(suggestions, '')) <= 400
          );
        """
    )


def downgrade() -> None:
    op.execute("alter table widgets drop column if exists suggestions")
