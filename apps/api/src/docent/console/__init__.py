"""The platform admin console: Docent's own view across every workspace.

Who may open it: a signed-in user with users.is_platform_admin and a verified
email (deps.PlatformAdmin). The flag is set only from the command line.

How it reads across tenants without BYPASSRLS: reads run in a transaction with
the app.platform_admin capability, which select-only policies honor on exactly
the tables these modules read (migration 0011). Changes run in the target
workspace's own tenant context instead, and each one, like each opening of a
workspace, is written to that workspace's audit log with the admin as actor.

What it never reads: message, knowledge, or customer memory content. Counts
and metadata only.
"""
