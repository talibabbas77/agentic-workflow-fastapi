"""Transactional email templates. Plain, direct, flat. Brand palette only."""

from html import escape

from docent.email.sender import OutgoingEmail

PAPER = "#F5F0E6"
INK = "#1B1916"
MUTED = "#5E574F"
LINE = "#DDD5C8"
RUST = "#B5431F"


def _html(heading: str, paragraphs: list[str], action_label: str, action_url: str) -> str:
    body = "".join(
        f'<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:{INK}">{escape(p)}</p>'
        for p in paragraphs
    )
    url = escape(action_url, quote=True)
    return f"""<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:{PAPER};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FBF8F2;border:1px solid {LINE}">
<tr><td style="padding:28px 32px 8px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-weight:600;font-size:20px;letter-spacing:-0.02em;color:{INK}">Docent</td></tr>
<tr><td style="padding:8px 32px 24px">
<h1 style="margin:0 0 16px;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-weight:600;font-size:22px;letter-spacing:-0.01em;line-height:1.3;color:{INK}">{escape(heading)}</h1>
{body}
<p style="margin:24px 0"><a href="{url}" style="display:inline-block;background:{RUST};color:{PAPER};text-decoration:none;font-size:15px;padding:12px 20px">{escape(action_label)}</a></p>
<p style="margin:0;font-size:13px;line-height:1.6;color:{MUTED}">If the button does not work, paste this link into your browser:<br><span style="word-break:break-all">{url}</span></p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:{MUTED}">You received this because of an action on your Docent account.</p>
</td></tr></table>
</body></html>"""


def _text(heading: str, paragraphs: list[str], action_label: str, action_url: str) -> str:
    lines = [heading, "", *paragraphs, "", f"{action_label}: {action_url}", ""]
    return "\n".join(lines)


def _build(
    to: str, subject: str, heading: str, paras: list[str], label: str, url: str
) -> OutgoingEmail:
    return OutgoingEmail(
        to=to,
        subject=subject,
        text=_text(heading, paras, label, url),
        html=_html(heading, paras, label, url),
    )


def verify_email(to: str, name: str, url: str, ttl_hours: int) -> OutgoingEmail:
    return _build(
        to,
        "Confirm your email for Docent",
        f"Confirm your email, {name}",
        [
            "Confirm this address so we can reach you about escalations and account changes.",
            f"The link works for {ttl_hours} hours.",
        ],
        "Confirm email",
        url,
    )


def reset_password(to: str, name: str, url: str, ttl_minutes: int) -> OutgoingEmail:
    return _build(
        to,
        "Reset your Docent password",
        "Reset your password",
        [
            f"Hi {name}. Someone asked to reset the password for this account.",
            f"The link works for {ttl_minutes} minutes. If it was not you, ignore this email.",
        ],
        "Choose a new password",
        url,
    )


def invitation(
    to: str, inviter: str, workspace: str, role: str, url: str, ttl_days: int
) -> OutgoingEmail:
    return _build(
        to,
        f"{inviter} invited you to {workspace} on Docent",
        f"Join {workspace} on Docent",
        [
            f"{inviter} invited you to the {workspace} workspace as {role}.",
            f"The invitation expires in {ttl_days} days.",
        ],
        "Accept invitation",
        url,
    )


def usage_threshold(
    to: str, name: str, workspace: str, percent: int, used: int, cap: int, url: str
) -> OutgoingEmail:
    if percent >= 100:
        return _build(
            to,
            f"{workspace} has used all of this month's AI replies",
            "Your agent is handing every message to your team",
            [
                f"Hi {name}. {workspace} has used all {cap:,} AI replies included this month.",
                "Until the month resets or you upgrade, the widget shows a contact form and every "
                "message reaches your inbox as a handoff. Nothing is billed beyond your plan.",
            ],
            "Review your plan",
            url,
        )
    return _build(
        to,
        f"{workspace} has used {percent} percent of this month's AI replies",
        f"{percent} percent of this month's replies used",
        [
            f"Hi {name}. {workspace} has used {used:,} of the {cap:,} AI replies included this "
            "month.",
            "When it reaches the cap, the widget shows a contact form and every message reaches "
            "your inbox as a handoff. Upgrade before then to keep the agent answering.",
        ],
        "Review your plan",
        url,
    )


# Inbox: replies to customers, notifications to the team, the daily digest.

REASONS = {
    "no_source": "No supporting source",
    "user_requested": "Asked for a person",
    "restricted_topic": "Restricted topic",
    "low_confidence": "Low confidence",
    "repeated_failure": "Could not help",
    "cap_reached": "Monthly replies used up",
}
FONT = "-apple-system,Segoe UI,Helvetica,Arial,sans-serif"


def _para(text: str, color: str = INK, size: int = 15) -> str:
    lines = "<br>".join(escape(line) for line in text.splitlines())
    return (
        f'<p style="margin:0 0 16px;font-size:{size}px;line-height:1.6;color:{color}">{lines}</p>'
    )


def _rows(pairs: list[tuple[str, str]]) -> str:
    cells = "".join(
        f'<tr><td style="padding:6px 16px 6px 0;vertical-align:top;font-size:13px;color:{MUTED};white-space:nowrap">{escape(k)}</td>'
        f'<td style="padding:6px 0;vertical-align:top;font-size:14px;line-height:1.5;color:{INK}">{escape(v)}</td></tr>'
        for k, v in pairs
    )
    return f'<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;border-top:1px solid {LINE};width:100%">{cells}</table>'


def _team_html(heading: str, body: str, action_label: str, action_url: str, footer: str) -> str:
    url = escape(action_url, quote=True)
    return f"""<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:{PAPER};font-family:{FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FBF8F2;border:1px solid {LINE}">
<tr><td style="padding:28px 32px 8px;font-weight:600;font-size:20px;letter-spacing:-0.02em;color:{INK}">Docent</td></tr>
<tr><td style="padding:8px 32px 24px">
<h1 style="margin:0 0 16px;font-weight:600;font-size:22px;letter-spacing:-0.01em;line-height:1.3;color:{INK}">{escape(heading)}</h1>
{body}
<p style="margin:8px 0 0"><a href="{url}" style="display:inline-block;background:{RUST};color:{PAPER};text-decoration:none;font-size:15px;padding:12px 20px">{escape(action_label)}</a></p>
</td></tr>
</table>
<p style="margin:16px 0 0;font-size:12px;color:{MUTED}">{escape(footer)}</p>
</td></tr></table>
</body></html>"""


def inbox_reply(
    to: str,
    workspace: str,
    sender_name: str,
    body: str,
    subject: str,
    reply_to: str,
    handoff_id: str,
) -> OutgoingEmail:
    """A team member's reply to a customer. It reads as the workspace's email, not Docent's."""
    signature = f"{sender_name}\n{workspace}"
    note = "Reply to this email to continue the conversation."
    text = f"{body}\n\n-- \n{signature}\n\n{note}\n"
    html = f"""<!doctype html>
<html><body style="margin:0;padding:24px 16px;background:#FFFFFF;font-family:{FONT}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px">
<tr><td>
{_para(body)}
<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid {LINE};font-size:14px;line-height:1.5;color:{INK}">{escape(sender_name)}<br><span style="color:{MUTED}">{escape(workspace)}</span></p>
<p style="margin:24px 0 0;font-size:12px;color:{MUTED}">{escape(note)}</p>
</td></tr></table>
</td></tr></table>
</body></html>"""
    thread = f"<handoff-{handoff_id}@docent>"
    return OutgoingEmail(
        to=to,
        subject=subject,
        text=text,
        html=html,
        reply_to=reply_to,
        from_name=f"{workspace} via Docent",
        headers={"References": thread, "In-Reply-To": thread},
    )


def new_handoff(
    to: str,
    workspace: str,
    issue: str,
    reason: str,
    priority: str,
    ticket_type: str | None,
    fields: list[list[str]],
    summary: dict[str, str] | None,
    contact: str | None,
    url: str,
    assigned_to_you: bool = False,
    rule: str | None = None,
) -> OutgoingEmail:
    pairs = [
        ("Why", REASONS.get(reason, reason)),
        ("Ticket type", ticket_type or "No type matched"),
        ("Priority", priority.capitalize()),
        ("Reply to", contact or "No email yet"),
    ]
    pairs += [(label, value) for label, value in fields]
    if summary:
        pairs += [
            ("Already tried", summary.get("tried", "")),
            ("About the customer", summary.get("user_context", "")),
            ("Next step", summary.get("suggested_next_step", "")),
        ]
    if rule:
        pairs.append(("Routed by", rule))
    pairs = [(k, v) for k, v in pairs if v]
    lead = (
        f"A handoff in {workspace} was assigned to you."
        if assigned_to_you
        else f"The agent handed a conversation in {workspace} to your team."
    )
    heading = "Assigned to you: " + issue if assigned_to_you else issue
    subject = f"[{workspace}] {'Assigned to you' if assigned_to_you else 'New handoff'}: {issue}"
    text_rows = "\n".join(f"{k}: {v}" for k, v in pairs)
    footer = f"You receive this because {workspace} routes these handoffs to you."
    return OutgoingEmail(
        to=to,
        subject=subject[:200],
        text=f"{lead}\n\n{issue}\n\n{text_rows}\n\nOpen in inbox: {url}\n",
        html=_team_html(heading, _para(lead) + _rows(pairs), "Open in inbox", url, footer),
        from_name=f"{workspace} via Docent",
    )


def handoff_assigned(
    to: str, name: str, workspace: str, issue: str, assigned_by: str, url: str
) -> OutgoingEmail:
    lead = f"Hi {name}. {assigned_by} assigned you a handoff in {workspace}."
    footer = "Turn these emails off under Automation, Notifications."
    return OutgoingEmail(
        to=to,
        subject=f"[{workspace}] Assigned to you: {issue}"[:200],
        text=f"{lead}\n\n{issue}\n\nOpen in inbox: {url}\n",
        html=_team_html(issue, _para(lead), "Open in inbox", url, footer),
        from_name=f"{workspace} via Docent",
    )


def daily_digest(
    to: str,
    name: str,
    workspace: str,
    open_count: int,
    unassigned: int,
    yours: int,
    new_today: int,
    oldest_hours: int | None,
    items: list[dict[str, str]],
    url: str,
) -> OutgoingEmail:
    lead = f"Hi {name}. Here is where the {workspace} inbox stands this morning."
    pairs = [
        ("Waiting on your team", str(open_count)),
        ("Assigned to you", str(yours)),
        ("Nobody assigned", str(unassigned)),
        ("New in the last day", str(new_today)),
    ]
    if oldest_hours is not None:
        pairs.append(("Oldest without a reply", f"{oldest_hours} hours"))
    listing = "".join(
        f'<li style="margin:0 0 10px"><a href="{escape(i["url"], quote=True)}" style="color:{INK};font-weight:600;text-decoration:underline">{escape(i["title"])}</a>'
        f'<br><span style="font-size:13px;color:{MUTED}">{escape(i["meta"])}</span></li>'
        for i in items
    )
    body = _para(lead) + _rows(pairs)
    if listing:
        body += f'<ul style="margin:0 0 20px;padding-left:18px;font-size:14px;line-height:1.5">{listing}</ul>'
    text_items = "\n".join(f"- {i['title']} ({i['meta']}): {i['url']}" for i in items)
    text_rows = "\n".join(f"{k}: {v}" for k, v in pairs)
    footer = "One email a day. Turn it off under Automation, Notifications."
    return OutgoingEmail(
        to=to,
        subject=f"[{workspace}] {open_count} open {'handoff' if open_count == 1 else 'handoffs'}, {yours} for you",
        text=f"{lead}\n\n{text_rows}\n\n{text_items}\n\nOpen the inbox: {url}\n",
        html=_team_html("Your inbox today", body, "Open the inbox", url, footer),
        from_name=f"{workspace} via Docent",
    )
