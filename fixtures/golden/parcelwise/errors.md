# Errors

When a request fails, the Parcelwise API returns an HTTP status code and a JSON error object. This page explains the format and lists the error codes you are most likely to see.

## Error response format

```json
{
  "error": {
    "type": "invalid_request_error",
    "code": "address_invalid",
    "message": "The destination address could not be verified.",
    "param": "to_address.postal_code",
    "request_id": "req_8f2cA91bXq"
  }
}
```

- `type` is the broad category: `authentication_error`, `invalid_request_error`, `carrier_error`, `billing_error`, or `api_error`.
- `code` is the specific reason. Your code should check `code`, not `message`, because messages can change.
- `param` names the field that caused the problem, when there is one.
- `request_id` identifies the request. It is also sent in the `Parcelwise-Request-Id` response header. Include it whenever you contact support.

## HTTP status codes

| Status | Meaning |
|---|---|
| 200 or 201 | The request succeeded |
| 400 | The request is malformed, for example invalid JSON or a missing required field |
| 401 | The API key is missing or not valid |
| 402 | A billing problem stopped the request |
| 403 | The key is not allowed to do this |
| 404 | The object does not exist, or it belongs to the other mode (test or live) |
| 409 | The request conflicts with the current state of the object |
| 422 | The request is valid, but a carrier or business rule rejected it |
| 429 | Too many requests |
| 500, 502, 503 | A problem at Parcelwise or at a carrier. Retry with backoff |

## Authentication and permission errors

| Code | Status | What it means and how to fix it |
|---|---|---|
| `missing_api_key` | 401 | No `Authorization` header was sent |
| `invalid_api_key` | 401 | The key is wrong, was rolled, or has expired. Check for extra spaces or a truncated key |
| `live_mode_not_enabled` | 403 | Live mode is paused for the account, for example while a verification review is open. Check the banner in the dashboard |
| `insufficient_scope` | 403 | A restricted key does not have the scope this endpoint needs |
| `ip_not_allowed` | 403 | The request came from an address outside the key's IP allowlist |

## Shipment and address errors

| Code | Status | What it means and how to fix it |
|---|---|---|
| `address_invalid` | 422 | The address could not be verified. Check the postal code and street, or send it without `verify` |
| `phone_required` | 422 | The carrier or destination needs a phone number on the address |
| `parcel_exceeds_limits` | 422 | No available carrier service accepts a parcel this heavy or this large |
| `customs_info_required` | 422 | The shipment crosses a border but has no `customs` object |
| `hs_code_invalid` | 422 | An HS code is not in the right format |
| `rate_expired` | 422 | The rate is too old to buy. Rerate the shipment and use a new rate ID |
| `service_unavailable_for_route` | 422 | The chosen service does not deliver between these two addresses |

## Label and billing errors

| Code | Status | What it means and how to fix it |
|---|---|---|
| `insufficient_balance` | 402 | Your balance does not cover the postage and fees. Add funds or turn on auto-reload |
| `payment_method_declined` | 402 | An automatic top-up or plan charge was declined. Update your payment method |
| `label_already_voided` | 409 | The label has already been voided |
| `label_already_scanned` | 422 | The carrier has scanned the label, so it cannot be voided |
| `void_window_closed` | 422 | The carrier's void window for this label has passed |
| `carrier_unavailable` | 503 | The carrier's systems are not responding. Retry later or choose another carrier |

## Idempotency errors

Network problems can leave you unsure whether a request went through. To retry `POST` requests safely, send an `Idempotency-Key` header with a unique value, such as a UUID, for each operation.

- Keys can be up to 255 characters and are remembered for 24 hours.
- If you send the same key with the same body again, you get the original response back, and nothing is created or charged a second time.

| Code | Status | What it means and how to fix it |
|---|---|---|
| `idempotency_key_mismatch` | 409 | The key was already used with a different request body. Use a new key for a new operation |
| `idempotency_key_in_use` | 409 | Another request with the same key is still being processed. Wait and retry |
