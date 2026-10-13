# Signing identity tokens

Identified mode needs one endpoint on your server that signs a short-lived token
for the user who is signed in. These examples do that in five languages. Each
one reads the same three settings from the environment:

| Variable | Where it comes from |
|---|---|
| `DOCENT_WIDGET_ID` | Widget settings, starts with `wid_` |
| `DOCENT_KEY_ID` | Widget settings, signing keys, starts with `key_` |
| `DOCENT_PRIVATE_KEY` | The `.pem` file you downloaded when you created the key |

The token carries:

| Claim | Value |
|---|---|
| `iss` | your widget id |
| `aud` | `docent` |
| `sub` | your stable user id |
| `iat`, `exp` | now, and at most 15 minutes later (5 minutes is plenty) |
| `jti` | a new random id for every token |
| `name`, `email` | optional, shown to your team in escalations |
| `ctx` | optional extra facts, such as the plan; only the claims allowed in widget settings are kept |

Sign tokens on your server only. Keep the private key in your secret store,
never in the browser or in source control.

Run `bash examples/signing/verify.sh` to check every example against a local
Docent API (after `pnpm seed`).
