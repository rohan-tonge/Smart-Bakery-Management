# Phase 7: Razorpay payments

## Provider and configuration

`payment.service.js` isolates Razorpay calls and uses the provider's server REST API over Node's built-in `fetch`; no new package is required. Credentials are read only from environment configuration. Set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_CURRENCY` (defaults to `INR`) and optionally `RAZORPAY_API_BASE_URL` (defaults to `https://api.razorpay.com`). Leave all three secrets blank to disable payment locally. When any credential is supplied outside tests, all three are required. Only the public Key ID is returned for Checkout.

Use test credentials with `rzp_test_...` during development. Do not use live credentials in local testing. Before production, configure live credentials only through a secret manager/environment, review webhook URL and event subscriptions, and perform a separate security and reconciliation review. This code does not automatically switch environments or perform refunds.

## Creation, amount, and duplicate attempts

`POST /api/v1/payments/create` accepts only an internal `orderId` from an authenticated customer. It verifies ownership, `PENDING_PAYMENT`, and an unexpired reservation. The server calculates paise from the saved order total (INR, two decimal places), then creates the Razorpay Order and persists its ID. Client-supplied amount/order totals are rejected. `Payment` records store amount in currency subunits, currency, internal order/customer references, provider identifiers, status, and limited metadata.

An `activeOrderKey` unique partial index permits one `CREATED` or `AUTHORIZED` attempt per internal order. An in-progress attempt is returned on retry; a failed attempt releases the key so a new traceable attempt can be created. A separate unique captured-order claim prevents two retry attempts for one bakery order from both being recorded as captured. Provider totals with precision finer than one paise are rejected instead of relying on binary floating-point rounding. A provider-create failure marks that attempt failed. Network ambiguity can still leave an orphan Razorpay Order if the provider created it but the response was lost; operations should reconcile such attempts.

## Verification and order state

`POST /api/v1/payments/verify` checks HMAC-SHA256 over `razorpay_order_id|razorpay_payment_id` with the secret, then retrieves the payment from Razorpay and checks provider order ID, amount, currency, and captured status. An authorized but uncaptured payment is recorded as `AUTHORIZED`; it does not confirm the bakery order. A captured payment transitions `PENDING_PAYMENT -> CONFIRMED`. Order status changes use compare-and-set filters, so stale cancel/expire requests cannot overwrite a competing payment confirmation. Captured-order uniqueness prevents two retry attempts from both reaching `CAPTURED`. Repeated verification is idempotent. Failure does not confirm the order or consume ingredients.

Cancellation/expiry of an unpaid order marks its open payment attempt `CANCELLED` and releases the active attempt key alongside Phase 6 reservation release. A signed late capture for a cancelled/expired attempt is recorded as captured with `metadata.captureNeedsReconciliation`, while the order remains cancelled/expired; the order is never revived by the old event. Cancellation of an already captured order is rejected until refund handling exists. Refund handling and late-capture reconciliation remain a controlled future extension; no fake refund status is created.

## Webhooks and idempotency

`POST /api/v1/payments/webhook` uses Razorpay's `x-razorpay-signature` HMAC over the exact raw request bytes and `x-razorpay-event-id`; it does not use customer JWT auth. Express saves the raw bytes for this route before JSON parsing. `PaymentEvent` has a unique provider event ID and a five-minute processing lease. Replayed processed events return success without repeating effects; a simultaneous delivery while the first is still running receives a retryable conflict rather than being acknowledged and lost. Failed/incomplete or expired event receipts can be retried.

Handled events are `payment.captured`, `payment.failed`, and `order.paid`. Captured/paid events confirm the matching eligible order after amount/currency checks. Failed events mark the payment failed and leave the order pending for retry, until its reservation expires. Unknown or unmatched events are recorded as ignored. No secrets or authorization headers are logged or exposed.

## APIs and information exposure

- `POST /api/v1/payments/create`
- `POST /api/v1/payments/verify`
- `POST /api/v1/payments/webhook`
- `GET /api/v1/payments/:id`

Customers can read only their own payment records; Owner/Manager can read by ID. Order detail includes a limited payment summary. Internal API responses never include the key secret or webhook secret. No inventory consumption, production batch, worker, or wastage action occurs on payment capture; Phase 8 can consume confirmed orders.

Order and Payment are separate MongoDB documents. Order status and reservation mutations use compare-and-set plus compensating rollback on standalone MongoDB, but a process failure between order confirmation and Payment persistence can still leave a temporary cross-document mismatch. Verification or webhook retries repair eligible pending attempts. Use a replica set or sharded cluster for transaction-level all-or-nothing behavior across both records.

## Testing

Automated tests inject a mock provider and cover amount conversion, ownership, duplicate attempt reuse, signature verification, captured order transition, raw-body webhook signature verification, failure behavior, event replay, and secret omission without calling Razorpay. Optional manual Test Mode verification requires configured test credentials and a reachable webhook endpoint; no live or real-provider payment was run as part of automated tests.
