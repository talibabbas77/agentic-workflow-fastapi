# Carriers

Parcelwise connects you to five carriers through one API. This page lists the carriers, their services and size limits, how to use your own carrier account, and how pickups work.

## Supported carriers

| Carrier | `carrier` code | Coverage | Best for |
|---|---|---|---|
| Ridgeway Parcel | `ridgeway` | United States | Everyday ground and economy parcels |
| Larkspur Express | `larkspur` | United States and Canada | Overnight and 2-day delivery |
| Bluecrest Post | `bluecrest` | Ships to 190 countries | Low-cost international parcels |
| Harborline Freight | `harborline` | United States and Canada | Heavy and oversized parcels |
| Kestrel Courier | `kestrel` | 12 metro areas | Same-day local delivery |

All five carriers are available on every plan. You do not need your own carrier account to use them.

## Service levels

| Service code | Typical transit time |
|---|---|
| `ridgeway_ground` | 2 to 5 business days |
| `ridgeway_economy` | 4 to 8 business days |
| `larkspur_overnight` | Next business day by 10:30 local time |
| `larkspur_2day` | 2 business days |
| `bluecrest_intl_priority` | 6 to 10 business days |
| `bluecrest_intl_economy` | 10 to 20 business days |
| `harborline_heavy` | 3 to 6 business days |
| `kestrel_same_day` | Same day, if the label is bought by 1 p.m. local time |

Only `larkspur_overnight` and `larkspur_2day` have guaranteed delivery dates. If a guaranteed Larkspur parcel arrives late, you can request a postage refund within 15 days of the delivery date from the label's page in the dashboard. Guarantees are suspended during weather events and other disruptions that the carrier has declared.

## Weight and size limits

| Carrier | Maximum weight | Maximum length | Maximum length plus girth |
|---|---|---|---|
| Ridgeway Parcel | 30 kg (66 lb) | 120 cm | 300 cm |
| Larkspur Express | 45 kg (99 lb) | 150 cm | 330 cm |
| Bluecrest Post | 20 kg (44 lb) | 105 cm | 200 cm |
| Harborline Freight | 68 kg (150 lb) | 270 cm | 420 cm |
| Kestrel Courier | 15 kg (33 lb) | 100 cm | No limit |

Girth is twice the width plus twice the height. When a parcel is over a carrier's limit, that carrier is left out of the shipment's rates.

## Using your own carrier account

If you already have negotiated rates with a carrier, you can connect your own account and buy labels at those rates through Parcelwise. This is available on the Growth plan and above.

1. Go to **Dashboard > Carriers** and select **Connect account**.
2. Choose the carrier and enter your account number and API credentials from that carrier.
3. Wait for verification, which usually takes 1 business day.

With a connected account, the carrier bills you for postage directly. The Parcelwise platform fee still applies to each label. You can connect up to 5 accounts per carrier, for example one per warehouse.

## Scheduling pickups

Instead of dropping parcels off, you can ask the carrier to collect them with `POST /v1/pickups`. Send the pickup address, a time window, and the IDs of the labels to collect.

| Carrier | Pickup fee |
|---|---|
| Ridgeway Parcel | Free |
| Larkspur Express | $5 per pickup |
| Harborline Freight | Free for 3 or more parcels, otherwise $8 |

Bluecrest Post and Kestrel Courier do not offer scheduled pickups through Parcelwise.

To get a pickup on the same day, schedule it by 12:00 local time. You can cancel a pickup up to 1 hour before the start of its time window.

## Carrier service disruptions

When a carrier has an outage or a major delay, we post an update at status.parcelwise.example and show a banner in the dashboard.

During a disruption, rates from the affected carrier may be missing from the `rates` array, and label purchases with that carrier may fail. Choose another carrier for urgent parcels, or retry later. Labels you already bought stay valid, and their trackers keep updating once the carrier recovers.
