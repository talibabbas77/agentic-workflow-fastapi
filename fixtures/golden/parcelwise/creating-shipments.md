# Creating shipments

A shipment describes one delivery: where it comes from, where it goes, and what is in the box. When you create a shipment, Parcelwise returns the rates available from every carrier that can deliver it. You then buy a label for the rate you choose.

## The shipment object

Create a shipment with `POST /v1/shipments`:

```json
{
  "from_address": { "name": "Example Store", "street1": "100 Sample Way", "city": "Anytown", "state": "CA", "postal_code": "90000", "country": "US" },
  "to_address": { "name": "Sam Customer", "street1": "200 Test Street", "city": "Sometown", "state": "WA", "postal_code": "98000", "country": "US" },
  "parcels": [ { "weight": 1.2, "weight_unit": "kg", "length": 30, "width": 20, "height": 10, "dimension_unit": "cm" } ]
}
```

The response includes the shipment `id` (starting with `shp_`), a `status` of `rated`, and a `rates` array.

Rates are valid for 24 hours after the shipment is created. To get fresh rates for an older shipment, call `POST /v1/shipments/{id}/rerate`. Shipments that never have a label bought are deleted automatically after 30 days.

## Addresses

Every address needs `name`, `street1`, `city`, `postal_code`, and `country` (a two-letter ISO country code). `state` is also required for the United States, Canada, and Australia.

A `phone` number is required for international shipments and for any shipment sent with Larkspur Express. An `email` is optional and is used for carrier delivery notifications.

Set `"residential": true` for home addresses. Some carriers charge more to deliver to residences, and a wrong value can lead to a carrier adjustment later.

### Address verification

Add `"verify": true` to an address to have Parcelwise check it before rating. The result is in the address's `verification` object, with a `status` of `verified`, `corrected`, or `failed`. When the status is `corrected`, the standardized address is used for the label. Verification is included on every plan at no extra cost.

## Parcels

- **Weight**: set `weight` and `weight_unit`, which can be `g`, `kg`, `oz`, or `lb`.
- **Dimensions**: set `length`, `width`, `height`, and `dimension_unit`, which can be `cm` or `in`. Dimensions are required for carriers that price by dimensional weight, so we recommend always sending them.
- **Carrier packaging**: instead of dimensions, you can set `predefined_package`, for example `ridgeway_flat_envelope`.

A shipment can contain up to 20 parcels. All parcels in one shipment go to the same address with the same carrier service and get one tracking number each.

## Choosing a rate

Each entry in the `rates` array includes:

- `id`: the rate ID, starting with `rate_`, that you use to buy a label.
- `carrier` and `service`: for example `ridgeway` and `ridgeway_ground`.
- `amount` and `currency`: the postage price.
- `delivery_days`: the estimated number of business days in transit.
- `delivery_date_guaranteed`: `true` if the carrier guarantees the date.

To limit which rates come back, send `rate_preferences` with the shipment, for example `{"carriers": ["ridgeway", "bluecrest"], "max_delivery_days": 3}`.

## International shipments and customs

A `customs` object is required whenever the destination country is different from the origin country. It includes:

- `contents_type`: `merchandise`, `gift`, `documents`, `sample`, or `return`.
- `items`: one entry per product type, with `description`, `quantity`, `value`, `weight`, `origin_country`, and `hs_code` (6 to 10 digits).
- `incoterm`: `DDU` (the recipient pays duties and taxes) or `DDP` (you pay them). The default is `DDU`.

Write specific item descriptions, such as "cotton t-shirt" rather than "clothing". Vague descriptions are a common reason for customs delays.

## Creating shipments in batches

To create many shipments at once, send up to 500 of them in one request to `POST /v1/shipments/batch`.

Batches run in the background. The response contains a batch `id` and a `status` of `processing`. When the batch finishes, Parcelwise sends a `batch.completed` webhook event. You can also check progress with `GET /v1/shipments/batch/{id}`.

Each shipment in a batch succeeds or fails on its own. The finished batch lists failed shipments with their error codes so you can fix and resend only those. To buy labels in the same step, set `"buy_label": true` along with the `carrier` and `service` to use for every shipment in the batch.
