# Phase 9: Wastage, Costing, and Profitability

## Wastage records

`WastageRecord` supports `PRODUCTION_OUTPUT`, `RAW_MATERIAL`, and `PACKAGING` types, with controlled reasons. Records retain the production batch, product/variant name snapshot, quantity/unit, recorder/time, notes, and where applicable ingredient, inventory lot, purchase, supplier, and inventory transaction references. Raw material wastage requires an idempotency key. Output wastage is unique per batch.

Output wastage quantity is already stored on the completed batch. The separate record captures its reason and remains outside finished stock. It must be recorded before cost finalization when the batch has output wastage. Its value is set using production cost per usable unit after finalization. Packaging wastage is operationally recorded; packaging is not inventory-managed in this system.

Raw-material wastage can be recorded only for a recipe ingredient during production. The inventory service checks unit compatibility, reservations, minimum stock, lot availability, and expiry; applies a conditional lot decrement; and creates a `WASTAGE` inventory transaction. Record creation is idempotent, and caught errors compensate the lot and transaction writes.

## Historical lot and cost snapshots

Production consumption snapshots the lot's unit cost, lot number, purchase/vendor references, and supplier name alongside the actual quantity consumed. Final cost calculation uses these stored values only; it does not read current ingredient prices, current inventory lot costs, current recipes, or current worker rates. Legacy batches without lot cost snapshots remain incomplete for actual cost finalization rather than being silently priced using today's data.

All monetary totals are stored as integer paise. Decimal strings are converted with `BigInt` and rounded half-up at the paise boundary. APIs expose rupees. Quantity times lot unit cost is rounded once per consumed lot line; component and batch totals sum integer paise.

## Production cost and finalization

For a completed batch:

`ingredient cost = actual consumed lot cost + separately recorded raw-material wastage cost`

`labour cost = Σ (assigned worker's hourly rate snapshot × recorded actual hours)`

`total production cost = ingredient cost + labour cost + fixed batch packaging cost + explicit other expenses`

Raw wastage is included in material cost and also reported as wastage value; wastage value is not added a second time. Finished output wastage value is `cost per usable item × wasted output quantity` and is reported separately from total cost.

Packaging uses an explicit fixed batch amount at finalization. Other expenses retain description, amount in paise, notes, recorder, and timestamp. Finalization requires lot cost snapshots, actual hours, hourly rate snapshots, and a reason record for nonzero output wastage. It is owner-only and guarded by a `NOT_FINALIZED → FINALIZING → FINALIZED` conditional state change. A finalized cost snapshot is immutable through the API; duplicate finalization conflicts.

`cost per usable item = total production cost / usable quantity`, rounded to the nearest paise. It is unavailable when usable quantity is zero. Output wastage percentage is `wastage quantity / produced quantity × 100`; it is unavailable when produced quantity is zero.

## Estimates and price impact

`POST /api/v1/costing/estimate` is read-only. It scales the active recipe, estimates ingredient cost from current eligible FEFO inventory lots while respecting reservations and minimum stock, optionally estimates labour from active workers' current configured rates and provided hours, and accepts a fixed packaging estimate. The result is labeled `ESTIMATED` and creates no batch or wastage record.

`POST /api/v1/costing/price-impact` compares the current estimate with a simulation of explicitly supplied future ingredient price percentage changes. It is labeled `ESTIMATE` and does not mutate any records.

## Revenue, operational profit, and margin

Revenue uses stored order line price snapshots for orders whose payment summary and payment record are `CAPTURED`; cancelled/expired or non-captured orders contribute no revenue. Current product prices are not consulted. Related batch costs are allocated across linked order item quantities. Product/variant operational cost uses finalized batch cost per usable item against sold units.

`operational profit = recognized revenue − allocated finalized production cost`

`margin % = operational profit / recognized revenue × 100`

Margin is unavailable when revenue is zero. This is operational production profitability, not net profit; rent, taxes, general payroll, depreciation, and other unmodeled business expenses are excluded.

## APIs

- Wastage: `POST/GET /api/v1/wastage`, `GET /api/v1/wastage/:id`, `GET /api/v1/wastage/summary`
- Batch costs: `GET /api/v1/production/batches/:id/cost`, `POST /api/v1/production/batches/:id/cost/finalize`
- Estimate/simulation: `POST /api/v1/costing/estimate`, `POST /api/v1/costing/price-impact`, `GET /api/v1/costing/summary`
- Profitability: `GET /api/v1/profitability/orders/:id`, `/batches/:id`, `/products/:id`, and `/variants/:id`

## Authorization and atomicity

Owners and managers can view costing and profitability; only owners finalize costs. Owners/managers and assigned production staff can record operational wastage. Staff can view only their own recorded wastage and assigned production records; customers cannot access cost, wastage, or profitability data.

Conditional claims and unique indexes prevent duplicate raw wastage and duplicate finalization. Inventory lot writes use compare-and-set and caught failures use compensating updates. On standalone MongoDB, inventory transaction, wastage record, batch cost, and stock changes are not a multi-document atomic unit. A process crash between writes may leave a processing record or require reconciliation. Production deployment should use a MongoDB replica set or sharded cluster and provide an operational reconciliation procedure before relying on crash recovery.
