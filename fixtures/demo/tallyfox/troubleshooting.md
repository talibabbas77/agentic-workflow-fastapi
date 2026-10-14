# Troubleshooting

## My client did not receive the invoice email

Ask the client to check their spam folder and to allow invoices@tallyfox.example. Then open the invoice and choose Resend. If the email still bounces, Tallyfox shows the reason on the invoice timeline, such as a mistyped address.

## The PDF looks wrong

Logos must be PNG or JPG and under 2 MB. Long line item descriptions wrap onto several lines; keep them under 300 characters. If text looks cut off, check the paper size in Settings > Invoices, A4 or Letter.

## A card payment shows as pending

Some card payments take a few minutes to confirm. If an invoice stays pending for more than an hour, open your Stripe dashboard to check the payment. Tallyfox updates the invoice as soon as Stripe confirms it.

## I cannot connect Stripe

You need a Stripe account in a supported country with charges enabled. Finish Stripe's verification steps first, then connect again from Settings > Payments.
