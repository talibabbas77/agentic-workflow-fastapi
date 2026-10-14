"""Worker wiring for the inbox: Slack messages, webhook deliveries, daily digests, and
the daily retention purge of delivery logs."""

from docent.inbox import events, notify, retention
from docent.inbox.outbound import OutboundDeps
from docent.jobs.worker import Handler, JobContext, Schedule


def make_inbox_handlers(deps: OutboundDeps) -> dict[str, Handler]:
    async def send_slack(ctx: JobContext) -> None:
        await notify.send_slack(ctx, deps)

    async def deliver_webhook(ctx: JobContext) -> None:
        await events.deliver_webhook(ctx, deps)

    async def send_digest(ctx: JobContext) -> None:
        await notify.send_digest(ctx, deps)

    async def purge_retention(ctx: JobContext) -> None:
        await retention.run_purge(ctx, deps.settings)

    return {
        notify.SEND_SLACK: send_slack,
        events.DELIVER_WEBHOOK: deliver_webhook,
        notify.SEND_DIGEST: send_digest,
        retention.PURGE_RETENTION: purge_retention,
    }


def inbox_schedules() -> list[Schedule]:
    return [
        Schedule("daily_digests", notify.SCHEDULE_EVERY_SECONDS, notify.schedule_digests),
        Schedule("retention", retention.SCHEDULE_EVERY_SECONDS, retention.schedule_retention),
    ]
