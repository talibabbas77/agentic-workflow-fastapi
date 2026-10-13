# Sandbox

The sandbox is a test environment where you can build and test your Parcelwise integration without shipping anything or spending money. Every account has a sandbox from the moment it signs up.

## How the sandbox works

You use the sandbox by sending requests with a test key. There is no separate URL. The sandbox behaves like live mode, with these differences:

- Labels are real-looking files marked "SAMPLE, DO NOT SHIP". Carriers will not accept them.
- Nothing is charged. Your sandbox balance starts with $10,000 in test funds and is reset to that amount on the 1st of every month.
- Rates are simulated. They are realistic but may not match live prices exactly.

To view sandbox data in the dashboard, switch the mode toggle at the top of the page to **Test**.

## Test addresses

Use these postal codes on a destination address to trigger specific outcomes:

| Postal code | Result |
|---|---|
| `00000` | Creating the shipment fails with `address_invalid` |
| `00001` | Address verification returns `corrected` with a suggested change |
| `99998` | Buying a label fails with `insufficient_balance` |
| `99999` | Buying a label fails with `carrier_unavailable` |

Any other complete address succeeds.

## Simulating tracking

To test how your system reacts to tracking changes, create a tracker in test mode with one of these tracking numbers:

| Tracking number | What happens |
|---|---|
| `PW_TEST_DELIVERED` | Moves through `pre_transit`, `in_transit`, `out_for_delivery`, and ends at `delivered` |
| `PW_TEST_EXCEPTION` | Ends at `failure` |
| `PW_TEST_RETURN` | Ends at `return_to_sender` |
| `PW_TEST_PICKUP` | Ends at `available_for_pickup` |

These simulated trackers move to the next status every 60 seconds and send the matching webhook events.

Labels you buy in the sandbox start at `pre_transit` and stay there. To move one forward, call `POST /v1/trackers/{id}/advance`, which works in test mode only.

## Testing webhooks

To send a sample event to an endpoint, switch to test mode, open **Dashboard > Developers > Webhooks**, select the endpoint, and select **Send test event**. Choose the event type you want. Test events contain sample data and have `"livemode": false`.

To receive events on your own computer during development, use the Parcelwise command-line tool:

```
parcelwise listen --forward-to localhost:8000/webhooks
```

The tool prints a temporary signing secret. Use it to verify signatures while it runs.

## Sandbox limitations

- Test mode allows 10 requests per second, whatever your plan.
- Sandbox data is deleted 90 days after it is created.
- Scheduled pickups and connected carrier accounts are not available.
- The return portal works, but it does not send emails to customers.
- Insurance claims and carrier adjustments are not simulated.

## Going live checklist

When your integration works in the sandbox:

1. Finish account verification so that live keys are available.
2. Replace your `pw_test_` key with a `pw_live_` key in your production configuration. Keep the test key for your staging environment.
3. Add your webhook endpoints again in live mode. Test and live endpoints are separate, and each has its own signing secret.
4. Add funds to your balance or turn on auto-reload.
5. Buy one real low-cost label and void it, to confirm the whole flow works end to end.
