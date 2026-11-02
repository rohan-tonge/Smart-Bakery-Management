# Phase 10: Analytics, Feedback, Complaints, Notifications

## Architecture

Phase 10 reads existing orders, captured payments, inventory lots and transactions, production batches, finalized batch costs, and wastage records. `analytics.service.js` performs the analytics calculations; customer engagement and notifications use separate services. Notifications are secondary side effects and are best effort, so a notification failure does not undo an order, payment, production, or complaint update. No external messaging provider or new infrastructure is used.

## Endpoints

All endpoints are below `/api/v1` and require a Bearer token unless otherwise stated.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /analytics/sales` | OWNER, MANAGER | Captured revenue, order counts and sales trend |
| `GET /analytics/orders` | OWNER, MANAGER | Order status, payment status, fulfillment and trend summaries |
| `GET /analytics/products` | OWNER, MANAGER | Historical order-line sales and production/wastage summaries; accepts `productId`, `variantId` |
| `GET /analytics/inventory` | OWNER, MANAGER, PRODUCTION_STAFF | Stock operations; only management receives stock valuation and supplier-linked lot details |
| `GET /analytics/production` | OWNER, MANAGER, PRODUCTION_STAFF | Batch quantities and production trend; staff results are restricted to assigned batches |
| `GET /analytics/wastage` | OWNER, MANAGER | Wastage by kind, reason, product, ingredient and day |
| `GET /analytics/satisfaction` | OWNER, MANAGER | Approved ratings, rating criteria averages, and rating trend |
| `GET /analytics/profitability` | OWNER, MANAGER | Captured revenue and immutable finalized production cost summaries |
| `GET /analytics/dashboard` | OWNER, MANAGER | Composed dashboard summaries; defaults to the last 30 days |
| `GET /alerts` | OWNER, MANAGER, PRODUCTION_STAFF | Current operational alerts; staff receive assigned production alerts only |
| `POST /feedback`, `GET /feedback/my`, `GET /feedback/:id`, `PATCH /feedback/:id` | CUSTOMER | Product/variant feedback tied to the customer's delivered order |
| `GET /feedback`, `PATCH /feedback/:id` | OWNER, MANAGER | Feedback administration |
| `GET /products/:productId/feedback-summary` | Authenticated users | Approved-rating aggregate without customer details |
| `POST /complaints`, `GET /complaints/my`, `GET /complaints/:id`, `PATCH /complaints/:id` | CUSTOMER | Own order complaint lifecycle |
| `GET /complaints`, `GET /complaints/:id`, `PATCH /complaints/:id` | OWNER, MANAGER | Complaint triage and resolution |
| `GET /notifications`, `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all` | Authenticated users | Own notification inbox |

Analytics routes accept `from`, `to`, and `group=day|week|month`. Date-only values are interpreted in UTC, with `from` at the start and `to` at the end of that date. Explicit timestamps are used as supplied. The default dashboard range is the previous 30 days through the current instant.

Sales revenue comes from order-line historical `lineTotal` values, and only orders with a captured Phase 7 payment count as paid revenue. Date filters for sales/products use order creation dates; production quantities use actual completion dates; finalized costs use cost finalization dates; inventory transactions use transaction creation dates; wastage uses record dates. Products use historical line totals and names, never current catalog prices. Costs use Phase 9 finalized paise snapshots; analytics do not recalculate historical costs. Inventory valuation and profitability fields are integer paise. Inventory value follows the inventory service's available-lot rules and excludes expired lots even if their status has not yet been changed. Empty revenue produces a null margin and `UNAVAILABLE` status.

Wastage quantities are grouped by record type and unit so unlike measures (such as kilograms and individual products) are not added together. Wastage value is reported separately by type in `valuePaiseByType`; raw-material loss and output-cost attribution are not combined into a misleading total because output attribution already includes material cost in the batch snapshot.

## Feedback and complaint rules

Feedback is unique per customer/order/product/variant, requires a delivered or completed order owned by the customer, and has a 1–5 overall rating. Optional named 1–5 criteria (names are supplied by the client because exact dimensions are not available here), free-form tags, and a plain photo/reference string are stored. No image upload/storage service or reward-points ledger is configured. Public product aggregates and management satisfaction analytics include approved feedback only. Customers can edit only their own feedback and cannot set its status.

Complaints must reference the customer's order. Customers cannot set priority, status, resolution, resolver, or internal notes. Management transitions are `OPEN → IN_REVIEW → RESOLVED → CLOSED`; `RESOLVED → IN_REVIEW` is the explicit reopen path. Status changes notify the customer best effort.

## Notifications and alerts

The notification model has a unique recipient/deduplication-key index. Payment capture/failure, order status changes, production assignments/completion, and complaint status updates create internal notifications. Notification creation failures are logged without customer content and do not roll back the source operation. Low stock and expiring lots are calculated as current alerts; expired-lot mutation is not performed by analytics or alerts reads. Alerts also show overdue planned batches, urgent unresolved complaints, expired unpaid reservations, and batches with at least 10% recorded Phase 9 output wastage relative to produced quantity for management.

## Indexes and limitations

Feedback indexes support customer/order lookup and product/variant rating summaries; its compound unique index prevents duplicate reviews. Complaints index customer history and status/priority queues. Notifications index recipient chronology, unread lookup, and deduplication. Existing Phase 1–9 indexes support the source records.

The database may run standalone, so Phase 10 does not claim cross-document transactionality for notifications. Notifications are intentionally secondary and deduplicated. Current low-stock and expiring-lot arrays are display lists capped at 1,000 rows and include exact database counts; stock valuation streams all eligible lots and transaction quantities are grouped in MongoDB. Historical sales, production, and wastage summaries still load matching records for application-level grouping, so very large installations may need further aggregation pipelines. The dashboard does not expose costs to production staff. No Phase 11 deployment or provider integration is included.

## Tests

`tests/phase10.test.js` covers feedback ownership/uniqueness, complaint transition and privacy checks, notification ownership, analytics endpoint access and response checks, exact UTC date boundaries and same-day ranges, invalid date ranges, separated wastage value/unit aggregation, expired-lot valuation, and staff alert access. Full-suite result is recorded after implementation verification.
