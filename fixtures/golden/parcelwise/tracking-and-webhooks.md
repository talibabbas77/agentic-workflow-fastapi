# Tracking and webhooks

Parcelwise follows every parcel you ship and tells your systems when something changes. This page covers trackers, tracking statuses, and how to receive and verify webhook events.

## Tracking a parcel

When you buy a label through Parcelwise, a tracker is created for it automatically. To track a parcel whose label you bought somewhere else, create a tracker yourself:

```
POST /v1/trackers
{ "tracking_number": "RW123456789", "carrier": "ridgeway" }
```

Read a tracker at any time with `GET /v1/trackers/{id}`. Parcelwise usually shows a carrier update within 15 minutes of the carrier publishing it. A tracker stays active until the parcel is delivered or returned to sender, or until 120 days after the tracker was created, whichever comes first.

Each parcel also has a public tracking page you can send to your customer at track.parcelwise.example followed by the tracking number.

## Tracking statuses

| `status` | Meaning |
|---|---|
| `pre_transit` | The label exists, but the carrier has not scanned the parcel yet |
| `in_transit` | The carrier has the parcel and it is moving |
| `out_for_delivery` | The parcel is on the vehicle for delivery today |
| `available_for_pickup` | The parcel is waiting at a pickup point or locker |
| `delivered` | The parcel was delivered |
| `return_to_sender` | The parcel is on its way back to you |
| `failure` | The parcel was lost, damaged, or could not be delivered |
| `unknown` | The carrier has not shared any information yet |

Each tracker also has a `status_detail` field with a more specific reason from the carrier, such as `address_issue` or `weather_delay`.

## Webhook events

Webhooks let Parcelwise send an HTTPS request to your server when something happens, so you do not have to poll. These events relate to tracking and labels:

| Event | Sent when |
|---|---|
| `tracker.created` | A new tracker starts following a parcel |
| `tracker.updated` | A tracker's `status` or `status_detail` changes |
| `tracker.delivered` | A tracker's `status` changes to `delivered` |
| `label.purchased` | A label is bought |
| `label.voided` | A carrier approves a void request |
| `label.void_rejected` | A carrier rejects a void request |
| `refund.completed` | Refunded postage is added to your balance |

Every event has an `id` starting with `evt_`, a `type`, a `created` timestamp, and the affected object in `data.object`. Events are kept for 30 days. You can list them with `GET /v1/events`.

## Adding a webhook endpoint

1. Go to **Dashboard > Developers > Webhooks** and select **Add endpoint**.
2. Enter your HTTPS URL. Plain HTTP URLs are not accepted.
3. Choose which events to send to this endpoint, or select all events.

You can add up to 16 endpoints per account in each mode.

Your endpoint must respond with a 2xx status within 10 seconds. A slower response, a redirect, or any other status counts as a failed delivery. To stay fast, save the event to a queue, respond right away, and do the real work afterward.

## Retries and failed deliveries

If a delivery fails, Parcelwise retries it up to 10 times over about 3 days. The waits between attempts are 1 minute, 5 minutes, 30 minutes, 1 hour, 2 hours, 4 hours, 8 hours, 12 hours, 18 hours, and 24 hours.

Because of retries, the same event can arrive more than once, and events can arrive out of order. Use the event `id` to ignore duplicates, and use the `created` timestamp, not arrival time, to decide which update is newest.

If an endpoint has no successful delivery for 5 days in a row, Parcelwise disables it and emails the account owners. After you fix the problem, turn the endpoint back on in the dashboard, then open each missed event in the event log and select **Resend**.

## Verifying webhook signatures

Every webhook request includes a `Parcelwise-Signature` header, for example:

```
Parcelwise-Signature: t=1760450000,v1=5257a869e7ecebeda32affa62cdca3fa51cad7e77a0e56ff536d0ce8e108d8bd
```

To check that a request really came from Parcelwise:

1. Split the header on commas and read the `t` value (a Unix timestamp) and the `v1` value.
2. Build the signed string by joining `t`, a period, and the raw request body, exactly as received and before any JSON parsing.
3. Compute an HMAC with SHA-256 over that string, using the endpoint's signing secret as the key. The secret starts with `whsec_` and is shown under **Dashboard > Developers > Webhooks**, by selecting the endpoint and then **Reveal secret**.
4. Compare your result with `v1` using a constant-time comparison.
5. Reject the request if `t` is more than 5 minutes away from your server's current time.

```python
import hmac, hashlib, time

def verify(header, raw_body, secret):
    parts = dict(item.split("=", 1) for item in header.split(","))
    signed = f"{parts['t']}.".encode() + raw_body
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    fresh = abs(time.time() - int(parts["t"])) <= 300
    return fresh and hmac.compare_digest(expected, parts["v1"])
```

To change a signing secret, select **Roll secret** on the endpoint. The old secret keeps working for 24 hours, and during that time each request carries two `v1` signatures, one for each secret.
