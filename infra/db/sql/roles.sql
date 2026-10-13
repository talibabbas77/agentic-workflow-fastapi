-- Docent database roles. Run once per Postgres cluster as an admin role.
--
--   psql -v owner_password=... -v app_password=... -v worker_password=... -f roles.sql
--
-- docent_owner   owns the schema, runs migrations, never used by the running app
-- docent_app     API process, row-level security enforced
-- docent_worker  job worker, row-level security enforced
\set ON_ERROR_STOP on

select format(
  'create role docent_owner login nosuperuser nocreatedb nocreaterole nobypassrls password %L',
  :'owner_password')
where not exists (select 1 from pg_roles where rolname = 'docent_owner') \gexec

select format(
  'create role docent_app login nosuperuser nocreatedb nocreaterole nobypassrls password %L',
  :'app_password')
where not exists (select 1 from pg_roles where rolname = 'docent_app') \gexec

select format(
  'create role docent_worker login nosuperuser nocreatedb nocreaterole nobypassrls password %L',
  :'worker_password')
where not exists (select 1 from pg_roles where rolname = 'docent_worker') \gexec

-- Guard rails per role. They apply at login, so they also hold behind a pooler.
alter role docent_app set statement_timeout = '15s';
alter role docent_app set idle_in_transaction_session_timeout = '30s';
alter role docent_worker set statement_timeout = '5min';
alter role docent_worker set idle_in_transaction_session_timeout = '5min';
