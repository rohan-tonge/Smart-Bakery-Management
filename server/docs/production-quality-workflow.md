# Production quality and packaging workflow

Production batches stay in the existing `ProductionBatch` collection. For new batches, the production path is:

```text
PLANNED → ACCEPTED → VERIFIED → IN_PRODUCTION → QUALITY_CHECK
  → PACKAGING → PACKAGED → COMPLETED → DELIVERED
```

An assigned worker may reject a `PLANNED` or `ACCEPTED` batch with a reason; `REJECTED` is terminal. Quality checks record `PASS` or `FAIL`, notes, actor, and timestamp. A failed check moves the batch to terminal `QUALITY_FAILED`; there is no rework transition because no rework policy is defined. Only `PASS` moves a batch to `PACKAGING`.

`POST /api/v1/production/batches/:id/complete` records baking output and moves to `QUALITY_CHECK`. It does not add finished stock. `POST /api/v1/production/batches/:id/quality-check` records the check. `POST /api/v1/production/batches/:id/package` accepts an optional packaged quantity (defaults to usable output and cannot exceed it), then records packaging actor/time and adds packaged units to finished stock once. `POST /api/v1/production/batches/:id/finalize` records the final `COMPLETED` transition; delivery is available only after that. Staff operations require the user to be assigned to the batch; management retains oversight.

The existing ingredient-consumption operation remains behind successful verification and records lot-level inventory transactions using the saved recipe snapshot. Batch detail now includes source orders, assignments, recipe snapshot, consumed lots, QC/package snapshots, and linked wastage. Production staff responses omit cost and supplier-price snapshots.

The local MongoDB deployment is standalone. The package-stock update and batch-state write therefore use an atomic claim plus compensating stock adjustment rather than a multi-document transaction. If process termination happens between those writes, reconciliation may be needed. Existing legacy `COMPLETED` batches are not automatically marked as quality-approved; they need operational review before being packaged under the stricter workflow.

Current planning still reports oven capacity as `NOT_CONFIGURED`. Worker availability uses active assignment and overlapping planned batches; there is no attendance/shift registry to establish roster availability or calculate daily-wage payroll. The existing hourly labour-rate snapshots and production task hours remain the supported costing inputs. Exact shift, daily-wage, attendance, and reward-points policies were not available to encode safely.
