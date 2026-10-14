"""Who may open the platform admin console. Only `docent admin grant|revoke <email>` and the
local demo seed change it; no screen and no API route can."""

from docent.config import Settings
from docent.db.pool import create_pool, transaction
from docent.services import accounts


async def set_access(settings: Settings, email: str, *, grant: bool) -> str:
    """Grant or revoke the flag and say what changed, in a sentence for the terminal."""
    pool = await create_pool(settings.database_url, max_size=1)
    try:
        async with transaction(pool) as conn:
            user = await accounts.set_platform_admin(conn, email, grant)
    finally:
        await pool.close()
    if user is None:
        raise SystemExit(f"No account uses {email}. Sign up first, then grant access.")
    if not grant:
        return f"{user['email']} is no longer a platform admin. /admin is closed to them now."
    if not user["verified"]:
        return (
            f"{user['email']} is a platform admin, but their email is not verified yet, so "
            "/admin stays hidden from them until they verify it."
        )
    return f"{user['email']} is a platform admin. Sign in as them and open /admin."
