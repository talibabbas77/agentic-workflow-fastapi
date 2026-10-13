# Account management for high-volume shippers

This page is for signed-in customers who have, or qualify for, a dedicated Parcelwise account team. It covers eligibility, negotiated carrier rates, priority support, the uptime commitment, and business reviews.

## Who qualifies

You get a dedicated account team if either of these is true:

- Your account is on the Enterprise plan.
- Your account ships 10,000 or more labels per month for 3 months in a row, on any paid plan.

When your account reaches the volume threshold, we email the account owners an invitation within 10 business days. You can also ask us to review your account at **Dashboard > Account > Account team > Request review**.

If an account that qualified on volume falls below 5,000 labels per month for 3 months in a row, it moves back to standard support after 30 days' notice.

## Negotiated carrier rates

Your account manager negotiates carrier rate cards on your behalf. Discounts are based on your monthly label volume and are applied to the standard Parcelwise postage rates:

| Monthly labels | Typical postage discount |
|---|---|
| 10,000 to 24,999 | Up to 8 percent |
| 25,000 to 49,999 | Up to 15 percent |
| 50,000 or more | Negotiated individually |

- A new rate card takes effect on the 1st of the month after you sign it.
- Rate cards are reviewed every quarter and adjusted based on your volume over the previous 90 days.
- Your current rate cards are listed under **Dashboard > Billing > Rate cards**.
- Rates returned by the API already include your negotiated prices. Each rate shows the `rate_card_id` it came from.

Negotiated rate cards are confidential and must not be shared outside your organization.

For accounts shipping more than 25,000 labels per month, the platform fee is also reduced to $0.01 per label.

## Priority support

Your account team includes a named account manager, available during business hours in your region, and a technical account manager who helps with integration work.

Urgent issues go through the priority support form at **Dashboard > Account > Account team > Report urgent issue**, which pages the on-call support engineer.

| Priority | Example | First response | Coverage |
|---|---|---|---|
| P1 | You cannot buy labels at all | 30 minutes | 24 hours a day, 7 days a week |
| P2 | Service is degraded, for example webhooks are delayed | 2 hours | 24 hours a day, 7 days a week |
| P3 | Questions and configuration help | 1 business day | Business hours |

We can also set up a shared support channel in your team's chat tool.

## Uptime commitment and service credits

Parcelwise commits to 99.95 percent monthly availability for the label purchase and tracking endpoints. If we miss that, you can claim a credit on your monthly platform fees:

| Monthly availability | Service credit |
|---|---|
| 99.0 percent to below 99.95 percent | 10 percent |
| 95.0 percent to below 99.0 percent | 25 percent |
| Below 95.0 percent | 50 percent |

Request a credit through your account manager within 30 days after the end of the affected month. Credits are applied to your next invoice. They apply to platform fees only, never to postage.

## Quarterly business reviews

Every quarter, your account manager prepares a review of your shipping, covering:

- Label volume and cost per label over time.
- On-time delivery rate by carrier and service.
- Exception and return rates.
- Recommendations, such as carrier mix changes or packaging changes that reduce adjustments.

Reviews are scheduled about 2 weeks after each quarter ends. The report is available afterward under **Dashboard > Account > Account team > Reviews**.

## Reaching your account team

The names and email addresses of your account manager and technical account manager are shown at **Dashboard > Account > Account team**. When your account manager is away, the page lists a named backup.

If an issue is not being resolved, escalate in this order: your account manager, then the head of customer operations at escalations@parcelwise.example.
