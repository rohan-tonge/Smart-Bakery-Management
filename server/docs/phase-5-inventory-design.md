# Phase 5 inventory design

- A purchase stores immutable item-level quantity, unit, unit price, and line total. Each purchase line creates one inventory lot with the same purchase unit and historical unit cost; later purchases never overwrite earlier lot costs.
- Current stock is calculated from available, non-expired lot balances and converted into the ingredient's configured unit. Mass and volume convert only within their own dimensions; pieces remain separate.
- Stock additions and removals update lot balances only through `inventory.service.js` and append inventory transactions. A removal allocates expiring lots first (FEFO), with lots without an expiry date considered after dated lots.
- Purchase writes use a MongoDB session transaction on replica-set or sharded deployments. The configured local standalone MongoDB does not support transactions, so the service performs compensating deletes if a write fails. This handles ordinary operation errors; a process or machine failure between standalone writes cannot provide true multi-document atomicity. Deploy a replica set for crash-safe transactions.
- Adjustment-added lots have a zero unit cost because no purchase price was provided. Their value is therefore excluded from inventory value until a future, explicitly costed adjustment is defined.
