# Phase 6: Cart, Orders, and Feasibility

## Cart and order records

Each authenticated `CUSTOMER` has one cart, enforced by a unique customer index. Cart lines keep product and variant IDs, quantity, and customer instructions. The API resolves the current variant price for display. Checkout ignores cart/client price fields and snapshots product/variant names, IDs, current unit price, line total, and order totals into the immutable order line. Current price changes do not alter past orders. Discount, tax, and delivery fee are currently zero; the server computes all totals.

Orders receive an atomic yearly sequence number (`ORD-YYYY-000001`). An optional `Idempotency-Key` binds a customer to a request fingerprint. New orders are `PENDING_PAYMENT`; this state means payment is pending and does not imply payment success. Delivery requires a structured address; pickup rejects one.

## Feasibility and inventory

The endpoint validates active products and variants, consumes finished stock first, then scales the active recipe by `production quantity / expectedYield`. Recipe ingredient lines are converted to each ingredient's canonical unit using Phase 4's measurement utility and aggregated by ingredient before checking inventory. Incompatible dimensions fail with a validation error. Phase 5 lot stock is read without mutation. `minimumStock` is treated as safety stock (`usable = current lots - minimumStock - active commitments`); `reorderLevel` remains only the purchasing threshold.

Phase 5 did not model finished goods, so `FinishedProductStock` is the smallest separate product/variant stock record. Owner/Manager can set on-hand quantity with `PUT /api/v1/orders/finished-stock`; it cannot be set below reserved units. Feasibility subtracts its `reservedQuantity` counter. Production needs report capacity `NOT_CONFIGURED` and a null readiness estimate. Finished-stock-only orders can report the current time. Recipe preparation/production duration is stored for future estimation, but worker capacity is not fabricated.

## Reservations and lifecycle

Checkout reruns feasibility and makes conditional updates to Ingredient `reservedStock` and finished stock `reservedQuantity`; those counters prevent two concurrent checkouts from reserving beyond current availability under the supported deployment. Ingredient reservations use each ingredient's unit and preserve its safety stock. Finished stock is allocated first; only its finished quantity is held. Reservations expire after `ORDER_RESERVATION_MINUTES` (default 15), configured in environment. Expired pending reservations are ignored during feasibility and lazily released during checkout; there is no background expiry job.

Allowed transitions are `PENDING_PAYMENT -> CONFIRMED/CANCELLED/EXPIRED`, `CONFIRMED -> CANCELLED/IN_PRODUCTION`, `IN_PRODUCTION -> READY`, `READY -> OUT_FOR_DELIVERY/COMPLETED`, `OUT_FOR_DELIVERY -> DELIVERED`, and `DELIVERED -> COMPLETED`. Cancellation and expiry release commitments. Completion releases raw commitments and consumes reserved finished goods. Raw ingredient physical consumption belongs to Phase 8 production execution.

Cancellation returns no stock transaction because no physical raw inventory was consumed. Reorder adds currently available prior lines to the caller's cart; it uses current prices on the next cart read/checkout and returns unavailable lines separately.

## Database deployment and next phases

The existing Phase 5 `runAtomicInventoryOperation` uses MongoDB transactions on replica sets/sharded clusters and compensating rollback on standalone MongoDB. Single-document reservation counters have conditional atomic guards in either configuration, but standalone MongoDB cannot provide true atomicity across ingredient counters, finished counters, and order creation. Production deployments requiring all-or-nothing cross-document checkout must use a replica set or sharded cluster. Operational rollback limitations are inherited from the Phase 5 strategy.

Phase 7 can transition pending orders to confirmed only after real payment verification and should expire/release failed payment reservations. No payment gateway or payment status was added. Phase 8 can replace the capacity provider, consume raw ingredient reservations into actual FEFO inventory transactions, and drive production status transitions from worker/batch events. Workers, production batches, costing, wastage, analytics, and notifications remain deferred.
