# Backup toolbox: pg_dump/pg_restore 17 (must match the server major version), age, curl.
FROM postgres:17-bookworm
RUN apt-get update \
 && apt-get install -y --no-install-recommends age curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
COPY infra/backup/dump.sh /usr/local/bin/docent-dump
RUN chmod +x /usr/local/bin/docent-dump
ENTRYPOINT []
