# Labels

A label is what you print and attach to the parcel. Buying a label charges your account for postage and gives you a tracking number. This page covers buying, formats, reprinting, voiding, and postage refunds.

## Buying a label

Buy a label with the rate ID you picked from a shipment:

```
POST /v1/labels
{ "rate_id": "rate_9Kx2Lm4P", "label_format": "pdf", "label_size": "4x6" }
```

The response includes the label `id` (starting with `lbl_`), the `tracking_number`, the `cost`, and a `label_url` to download the file.

Postage and fees are charged from your balance at the moment of purchase. The `label_url` is a signed link that expires after 1 hour. To get a new link, call `GET /v1/labels/{id}`.

## Label formats and sizes

| Format | `label_format` | Sizes | Notes |
|---|---|---|---|
| PDF | `pdf` | `4x6`, `A6`, `letter` | Default. Letter size prints one label per page |
| PNG | `png` | `4x6` | 300 dpi |
| ZPL | `zpl` | `4x6` | For thermal printers, 203 or 300 dpi |

If you do not set a format, you get a 4x6 inch PDF.

You can get the same label in a different format after purchase, at no cost, by calling `GET /v1/labels/{id}?format=zpl` (or `pdf` or `png`). The tracking number does not change.

## Reprinting a label

Label files are kept for 90 days after purchase. To reprint within that time, open **Dashboard > Labels**, select the label, and select **Download**, or call `GET /v1/labels/{id}`.

After 90 days the label file is deleted. Tracking continues to work, but you cannot download the label again. If a parcel has not shipped by then, void the old label and buy a new one.

## Voiding a label

Void a label you will not use to get the postage back. You can only void a label that the carrier has not scanned yet.

- **API**: `POST /v1/labels/{id}/void`
- **Dashboard**: open **Labels**, select the label, and select **Void label**. You can select up to 100 labels and void them together.

After you request a void, the label `status` changes to `void_requested`. When the carrier responds, it changes to `voided` or `void_rejected`. Do not ship a parcel with a label you have asked to void, even if the void is later rejected.

## Refund windows and timing

You must request a void within the carrier's void window. After the carrier approves it, the postage is refunded to your Parcelwise balance, not to your card.

| Carrier | Void window after purchase | Time until refund reaches your balance |
|---|---|---|
| Ridgeway Parcel | 30 days | 5 to 7 business days |
| Larkspur Express | 14 days | 10 to 15 business days |
| Bluecrest Post | 28 days | 15 to 21 business days |
| Harborline Freight | 7 days | 5 business days |
| Kestrel Courier | 24 hours | 1 business day |

If you bought the label through your own connected carrier account, the carrier handles the refund directly, and it does not go to your Parcelwise balance.

## Commercial invoices and customs forms

When a shipment includes customs information, Parcelwise generates the required customs documents along with the label. They are returned in the label's `forms` array as PDF links, usually a commercial invoice.

- Larkspur Express and Bluecrest Post accept customs data electronically. You do not need to print the forms for these carriers.
- For other carriers, print 3 copies of the commercial invoice, sign them, and place them in a clear pouch on the outside of the parcel.

Customs forms are kept for the same 90 days as the label file.
