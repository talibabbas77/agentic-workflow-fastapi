# API authentication

The Parcelwise API uses secret API keys to authenticate requests. This page explains the types of keys, how to create and rotate them, and what to do if a key is exposed.

## How authentication works

Send your API key as a bearer token in the `Authorization` header of every request:

```
curl https://api.parcelwise.example/v1/shipments \
  -H "Authorization: Bearer pw_live_4eC39HqLyjWDarjtT1zdp7dc"
```

All requests must use HTTPS with TLS 1.2 or later. Requests sent over plain HTTP are refused. Requests with a missing or unrecognized key are rejected with HTTP status 401.

Keep secret keys on your server. Never put them in browser code, mobile apps, or anything else your customers can download.

## Test keys and live keys

Every account has two sets of keys, one for each mode:

| Key type | Prefix | What it is for |
|---|---|---|
| Test secret key | `pw_test_` | Requests run in the sandbox. Nothing is shipped or charged. |
| Live secret key | `pw_live_` | Creates real labels and charges your account. |
| Restricted key | `pw_rk_test_` or `pw_rk_live_` | Like a secret key, but limited to the scopes you choose. |

Both modes use the same base URL, `https://api.parcelwise.example/v1`. The key you send decides which mode the request runs in. Objects created in one mode cannot be read or changed with a key from the other mode.

Test keys are available as soon as you sign up. Live keys become available after you complete account verification by adding your business name, business address, tax ID, and a payment method. Verification is usually finished within 1 business day.

## Creating keys

1. Go to **Dashboard > Developers > API keys**.
2. Make sure the mode switch at the top shows the mode you want (Test or Live).
3. Select **Create secret key** and give the key a name that says where it will be used, such as "production web server".

The full key is shown only once, when you create it. Copy it into your secrets manager right away. After that, the dashboard shows only the last 4 characters.

You can have up to 10 active secret keys in each mode. Only users with the Owner or Developer role can create, roll, or delete keys.

## Restricted keys

A restricted key can only do what its scopes allow. Use restricted keys for services that need limited access, such as a warehouse app that only prints labels.

| Scope | Allows |
|---|---|
| `shipments:read` | Read shipments and rates |
| `shipments:write` | Create and update shipments |
| `labels:write` | Buy, reprint, and void labels |
| `trackers:read` | Read trackers and tracking events |
| `returns:write` | Create and update returns |
| `billing:read` | Read balance, invoices, and adjustments |

A request that needs a scope the key does not have is rejected with HTTP status 403.

## Rotating keys

Rotate keys regularly, and whenever someone with access to a key leaves your team.

1. Go to **Dashboard > Developers > API keys**.
2. Select **... > Roll key** next to the key.
3. Choose when the old key stops working: **Now**, **In 1 hour**, **In 24 hours**, or **In 7 days**.
4. Copy the new key and deploy it.

Until the expiry you chose, both the old and the new key work, so you can deploy without downtime. The dashboard shows a reminder next to any key older than 12 months.

## If a key is exposed

If a secret key may have been seen by someone who should not have it:

1. Roll the key and choose **Now** so the old key stops working immediately.
2. Open **Dashboard > Developers > Logs**, filter by the old key, and look for requests you do not recognize. Request logs are kept for 30 days.
3. Void any labels you did not create.

Parcelwise also scans public code hosting sites for live keys. If we find one of yours, we roll it automatically with a 1-hour expiry and email the account owners.

## IP allowlists

For extra protection, you can limit a live key to requests from your own servers. Open the key in **Dashboard > Developers > API keys** and select **IP allowlist**.

You can add up to 25 IPv4 or IPv6 CIDR ranges per key. Requests from any other address are rejected with HTTP status 403. IP allowlists are not available for test keys.
