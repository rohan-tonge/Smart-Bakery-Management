# Phase 8: Workers and Production

## Worker model

Workers are existing `User` records with the `PRODUCTION_STAFF` role. The user schema adds a job designation and optional hourly labour rate; credentials remain in the shared authentication model. Worker deletion is a soft deactivation and clears refresh tokens. Assignment records snapshot the current hourly rate and retain task, assignment time, and optional actual hours.

OWNER and MANAGER can create, list, view, update, and deactivate production staff. Production staff can see their own assigned batches and update only their assignment task/hours. Customers have no worker or production access.

## Production batch and batch numbers

`ProductionBatch` stores the product and variant IDs plus a product/variant name and size snapshot, recipe reference/revision, planned and actual quantities, status, workers, planned/actual times, notes, related orders, ingredient snapshots, and actual lot consumption. Batch numbers use a daily MongoDB counter document and a unique index, for example `BATCH-20260930-0001`. Counter upserts retry on duplicate-key races.

## Recipe snapshot and scaling

Planning requires active product, variant, recipe, recipe ingredients, and workers. Planned quantity is finished output quantity. The recipe's expected yield defines how many recipe batches are needed: `plannedQuantity / expectedYield`. A non-integral yield multiple is rejected. The batch snapshots recipe revision, expected yield, yield unit, recipe batch quantity, and each scaled ingredient quantity/unit/name. Later recipe edits and ingredient deactivation or price changes do not rewrite that snapshot.

## Status machine

Allowed paths are `PLANNED → IN_PRODUCTION → COMPLETED → PACKAGED → DELIVERED`, with `PLANNED → CANCELLED`. Cancellation is terminal. Updates use conditional MongoDB filters; arbitrary status updates are not accepted. Starting rechecks active assigned workers and inventory availability without consuming ingredients.

## Ingredient consumption

The explicit consume operation claims the batch with a conditional status update. The inventory service allocates active, unexpired lots in FEFO order, checks compatible units and available stock after customer reservations, production reservations, and minimum stock, and writes `CONSUMPTION` inventory transactions with `referenceType: PRODUCTION` and the batch ID. The batch stores actual lot IDs, lot numbers, ingredient names, quantities, and units. A partial unique index prevents duplicate production transactions for the same batch/ingredient/lot/type.

Inventory lot changes use compare-and-set updates and are compensated if a later write fails. A temporary ingredient-level production reservation coordinates production consumption with customer order reservations and stock-removal adjustments.

## Completion and finished stock

Completion requires consumed ingredients, non-negative integer quantities, and `produced = usable + wastage`. A conditional completion claim prevents a second completion. Only usable quantity is added to `FinishedProductStock`; wastage is not stocked. Finished stock is updated atomically per document. Production completion does not change linked customer order status. Packaging and delivery are separate manager operations.

## Order traceability

Only existing confirmed orders containing the batch product/variant can be linked. The batch keeps order references. The chain from order to batch, recipe revision snapshot, actual consumption, and inventory lot is available without changing the order's payment/delivery lifecycle.

## Concurrency and MongoDB deployment

Batch counters, starts, consumption claims, completion claims, and status changes use unique indexes or conditional updates. Lot consumption uses compare-and-set; inventory and finished-stock writes have compensating rollback for caught failures. No multi-document transaction is assumed on local standalone MongoDB.

Standalone MongoDB cannot guarantee atomicity across ingredient reservations, multiple inventory lots/transactions, the batch record, and finished stock. A process crash between those writes can require reconciliation; an in-process exception is compensated. Production deployment should use a MongoDB replica set or sharded cluster with transaction support and should add an operational reconciliation path before relying on crash recovery for inventory execution.

Phase 8 does not calculate profitability, production costs, wastage analytics, or labour-cost reports.
