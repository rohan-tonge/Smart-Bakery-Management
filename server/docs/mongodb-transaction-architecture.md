# MongoDB Transaction Behavior & Atomicity Specification

## 1. Overview

In the Smart Bakery Management System, critical business operations (such as order checkout, stock deductions, production batch ingredient consumption, and finished goods reconciliation) span multiple collections (`orders`, `inventoryLots`, `inventoryTransactions`, `ingredients`, `finishedProductStocks`, and `productionBatches`).

This document details precisely how atomicity is handled across different MongoDB deployment topologies.

---

## 2. Deployment Topology Behavior

The backend dynamically inspects the database topology at runtime via `supportsMongoTransactions()`:

```javascript
export const supportsMongoTransactions = () => {
  const type = mongoose.connection.client?.topology?.description?.type;
  return type === "ReplicaSetWithPrimary" || type === "Sharded";
};
```

### A. Replica Sets & Sharded Clusters (Production Recommended)
- **Multi-Document Atomicity**: **Fully Guaranteed (ACID)**.
- **Mechanism**: The backend executes operations inside `session.withTransaction()`. If any step fails, MongoDB aborts the entire transaction, and all modifications across all collections are rolled back atomically by the database engine.
- **Concurrency**: WiredTiger snapshot isolation prevents dirty reads and phantom updates.

### B. Standalone MongoDB (Local Development Default)
- **Single-Document Operations**: **Atomic**.
  - Atomicity is guaranteed by MongoDB for operations affecting a single document (e.g., `findByIdAndUpdate` with `$inc`, `$set`, or optimistic lock version checks).
- **Multi-Document Operations**: **Compensating Rollback (Best-Effort)**.
  - Standalone MongoDB engines do **not** support multi-document transactions (`startSession()` fails if transactions are invoked).
  - The backend executes operations in sequence without an engine-level transaction.
  - If an error occurs during execution, the application executes a registered compensating `rollback()` handler to undo preceding writes.
  - **Limitation**: If the Node.js process crashes, power is lost, or the database host disconnects mid-sequence before the compensating rollback executes, partial writes may persist in the database, necessitating manual operational reconciliation via `InventoryTransaction` audit logs.

---

## 3. Safeguards & Best Practices

1. **Idempotency Keys**: All stock-mutating requests accept an `Idempotency-Key` header to prevent duplicate execution on network retry.
2. **Optimistic Locking**: Production batch state transitions use conditional query filters (`status: expected_status`) to prevent concurrent race conditions.
3. **Transaction Ledgers**: Every stock change creates an immutable `inventoryTransaction` record with previous/subsequent quantities and references to the triggering order or batch, enabling audit and automated reconciliation.
4. **Production Recommendation**: Production deployments MUST use a MongoDB Replica Set (e.g. MongoDB Atlas or a 3-node self-hosted replica set) to ensure true multi-document transactional integrity.
