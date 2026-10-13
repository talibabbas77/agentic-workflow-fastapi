-- Post-restore checks. Fails loudly if tenant isolation did not survive the restore.
\set ON_ERROR_STOP on

do $$
declare
  missing text;
  elevated text;
begin
  select string_agg(c.relname, ', ') into missing
  from pg_class c
  where c.relnamespace = 'public'::regnamespace
    and c.relkind = 'r'
    and c.relname <> 'jobs'
    and (c.relname = 'tenants' or exists (
          select 1 from pg_attribute a
          where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped))
    and not (c.relrowsecurity and c.relforcerowsecurity and exists (
          select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname));
  if missing is not null then
    raise exception 'row-level security missing after restore on: %', missing;
  end if;

  select string_agg(rolname, ', ') into elevated
  from pg_roles
  where rolname in ('docent_app', 'docent_worker') and (rolbypassrls or rolsuper);
  if elevated is not null then
    raise exception 'app roles can bypass RLS: %', elevated;
  end if;
end $$;

select 'rls ok' as check;
