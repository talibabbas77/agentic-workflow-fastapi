-- Per-database setup. Run as an admin role while connected to the target database.
-- The database itself must already exist and be owned by docent_owner.
\set ON_ERROR_STOP on

create extension if not exists vector;

-- Only the owner may create objects. App roles get usage and table grants from migrations.
revoke create on schema public from public;
grant usage on schema public to docent_app, docent_worker;
