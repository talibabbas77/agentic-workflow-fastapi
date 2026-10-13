# Rate limits

Parcelwise limits how many API requests you can send in a short period so that one integration cannot slow down the API for everyone. This page lists the limits, the headers that report them, and how to handle a limit error.

## Limits by plan

Rate limits apply per account, across all of your live API keys combined.

| Plan | Sustained requests per second | Burst |
|---|---|---|
| Starter | 20 | 40 |
| Growth | 100 | 200 |
| Scale | 300 | 600 |
| Enterprise | Custom, starting at 500 | Custom |

The burst value is the most requests you can send at once after a quiet period. Think of it as a bucket that holds that many requests and refills at your sustained rate. For example, a Growth account that has been idle can send 200 requests in the same second, and then 100 per second after that.

These limits apply to live mode. Test mode has its own limit, described in the sandbox guide.

## Endpoint limits

Some endpoints have an extra limit on top of your plan limit. Both limits apply, and whichever you reach first is enforced.

| Endpoint | Extra limit |
|---|---|
| `POST /v1/labels` | 30 requests per second, on every plan |
| `POST /v1/shipments/batch` | 5 batches in progress at the same time |
| `GET /v1/trackers/{id}` | 60 requests per minute for the same tracker |
| `POST /v1/addresses/verify` | 50 requests per second |

## Rate limit headers

Every API response includes these headers:

| Header | Meaning |
|---|---|
| `X-RateLimit-Limit` | Your sustained limit in requests per second |
| `X-RateLimit-Remaining` | Requests left in your bucket right now |
| `X-RateLimit-Reset` | Unix time, in seconds, when your bucket will be full again |

When a request is rejected for exceeding a limit, the response also includes a `Retry-After` header with the number of seconds to wait before trying again.

## Handling 429 responses

When you exceed a limit, the API returns HTTP status 429 with the error code `rate_limited`. A rejected request is not processed and nothing is charged, so it is always safe to send it again.

To retry well:

1. If the response has a `Retry-After` header, wait that many seconds.
2. Otherwise, use exponential backoff: wait 1 second, then 2, then 4, and so on, up to a maximum of 30 seconds between attempts.
3. Add a random delay of up to 1 second to each wait so that many workers do not retry at the same moment.
4. Stop after 6 attempts and alert your team rather than retrying forever.

```python
import random, time

def call_with_retry(send):
    delay = 1
    for attempt in range(6):
        response = send()
        if response.status_code != 429:
            return response
        wait = float(response.headers.get("Retry-After", delay))
        time.sleep(wait + random.random())
        delay = min(delay * 2, 30)
    raise RuntimeError("Parcelwise rate limit: giving up after 6 attempts")
```

## Reducing the number of requests

Most integrations that hit limits can avoid them with a few changes:

- Subscribe to tracking webhooks instead of polling trackers on a schedule.
- Create shipments with the batch endpoint when you have more than a handful at once.
- Use the `expand` query parameter to fetch related objects in one call, for example `GET /v1/shipments/{id}?expand=rates,label`.
- Spread large jobs, such as end-of-day label printing, over several minutes instead of sending everything in one second.

## Requesting a higher limit

Accounts on Growth and Scale can request a temporary increase for busy periods such as holiday sales.

1. Go to **Dashboard > Settings > Rate limits** and select **Request increase**.
2. Enter the dates, the expected peak requests per second, and the endpoints you will call most.
3. Submit the request at least 5 business days before you need it.

Temporary increases can raise your limit to up to 2 times your plan limit for up to 45 days. Permanent increases above the Scale limit are available on the Enterprise plan.
