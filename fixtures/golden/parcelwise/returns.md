# Returns

Parcelwise helps you get products back from your customers: creating return labels, letting customers start returns on their own, and tracking returns until you close them.

## Ways to create a return label

You can create a return label in three ways:

1. **API**: create a shipment with `"is_return": true`. You can send the same `from_address` and `to_address` as the original shipment. Parcelwise swaps them on the label, so the parcel goes back to you.
2. **Dashboard**: open **Shipments**, select a delivered shipment, and select **Create return**.
3. **Return portal**: let customers create their own return, as described below.

You can email a return label to your customer from Parcelwise, or print it and put it in the box with the original order.

## Pay-on-scan return labels

A standard return label is charged when you create it, whether or not the customer uses it. A pay-on-scan label is charged only when the carrier first scans it. This is useful when you include a return label in every order.

To create one, add `"payment": "on_scan"` to the return shipment.

- Pay-on-scan labels are available with Ridgeway Parcel and Bluecrest Post.
- Each scanned label has a $0.15 service fee in addition to the postage.
- Unused pay-on-scan labels expire 60 days after they are created, and you are not charged for them.

## The hosted return portal

The return portal is a page where customers start a return themselves, at returns.parcelwise.example followed by your store's slug. It is available on the Growth, Scale, and Enterprise plans.

Customers sign in to the portal with their order number and either their email address or their postal code. For this to work, orders must be created through Parcelwise with an `order_number`.

To customize the portal, go to **Dashboard > Returns > Portal settings**. You can add your logo, choose a brand color, edit the list of return reasons, and add a message for customers. On Scale and Enterprise, you can also serve the portal from your own domain by adding a CNAME record.

## Return rules

Set the rules for returns under **Dashboard > Returns > Rules**:

- **Return window**: how long after delivery a customer can start a return. The default is 30 days, and you can choose anything from 7 to 90 days.
- **Final sale items**: mark products by SKU or tag as not returnable. The portal will not offer them.
- **Who pays for return shipping**: you can pay for the label, deduct the label cost from the customer's refund (shown to the customer in the portal), or ask customers to arrange their own shipping.
- **Photos**: require photos when the reason is "damaged". Customers can upload up to 3 photos of up to 10 MB each.
- **Approval**: approve requests automatically, or review each one before a label is issued.

## Printerless returns with QR codes

Customers who do not have a printer can get a QR code instead of a label. They show the code at a drop-off location, and the staff there print the label.

QR code returns are supported at Ridgeway Parcel and Kestrel Courier drop-off locations. Each QR code is valid for 14 days. To offer this option, turn on **Allow QR code returns** in **Dashboard > Returns > Portal settings**.

## Tracking and closing returns

Each return moves through these statuses: `requested`, `approved`, `label_issued`, `in_transit`, `received`, and then `closed` or `rejected`.

When the carrier marks the return parcel as delivered, its status changes to `received` automatically. After you inspect the items, open the return and select **Close return**, then choose the outcome: refund, exchange, store credit, or rejected.

Parcelwise does not send money to your customers. Choosing "refund" records the outcome only. Issue the actual refund in your store or payment system.
