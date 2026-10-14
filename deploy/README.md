# Deploy the showcase

One server, one command. Everything that runs locally in Docker runs here
too, behind Caddy with free HTTPS certificates. You do not need a domain: the
script uses `sslip.io` hostnames that point at the server's IP address.

| Address | What it is |
|---|---|
| `https://app.<ip>.sslip.io` | Landing page, login, the admin app, `/admin` |
| `https://demo.<ip>.sslip.io/lumen-notes` | Demo site for anonymous visitors, with the widget |
| `https://demo.<ip>.sslip.io/parcelwise` | Demo site for signed-in customers, with the widget |
| `https://api.<ip>.sslip.io` | The API and the widget script |

## What you need

- A server running Ubuntu 22.04 or 24.04 with at least 4 GB of memory
  (8 GB is smoother) and ports 80 and 443 open. Any provider works, for
  example a small Hetzner, DigitalOcean, or Linode server.
- The repository on GitHub, public (or pass `REPO_URL` with a token in it).
- An ollama.com account. The chat model runs on Ollama's cloud; the embedding
  model runs on the server.

## Steps

1. Push this repository to GitHub.
2. Create the server and log in with SSH.
3. Run:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/talibabbas77/agentic-workflow-fastapi/main/deploy/install.sh \
     | sudo OWNER_EMAIL=you@example.com bash
   ```

4. When the script shows an ollama.com link, open it, sign in, and approve the
   server. The script then loads the demo companies and prints the addresses
   and your login. They are also saved in `/opt/docent/deploy/credentials.txt`.

The first build takes 10 to 20 minutes. Running the script again is safe: it
keeps the settings and data and only fills in what is missing.

## Good to know

- **Sign-ups are closed** on the showcase, so visitors try the demo sites
  instead of making workspaces that would use your Ollama allowance. To open
  them, set `SIGNUPS_OPEN=true` in `deploy/.env` and run `update.sh`.
- **Email** stays inside the server (Mailpit) unless you add an SMTP service,
  for example Resend or Brevo, with `SMTP_HOST`, `SMTP_PORT`, `SMTP_USERNAME`,
  `SMTP_PASSWORD`, `SMTP_STARTTLS=true`, and `EMAIL_FROM` in `deploy/.env`.
- **Payments** are off until you add Stripe test keys (`STRIPE_SECRET_KEY`,
  `STRIPE_WEBHOOK_SECRET`) to `deploy/.env`.
- **Your own domain:** create `app.`, `api.`, and `demo.` records pointing at
  the server, then run the script with `DOMAIN=example.com` on a fresh server
  (or change the three hosts in `deploy/.env` and run `update.sh`).
- **Updating:** `sudo /opt/docent/deploy/update.sh` pulls, rebuilds, and
  restarts.
- **Logs:** `cd /opt/docent/deploy && sudo docker compose logs -f api worker`.
- The deployment runs as `DOCENT_ENV=production` with generated secrets,
  Secure cookies, and only ports 80 and 443 open. It is a showcase, not a
  production setup: there are no backups, and everything runs on one machine.
