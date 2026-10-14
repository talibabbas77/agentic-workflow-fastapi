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
