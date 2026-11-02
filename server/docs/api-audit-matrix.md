# API audit matrix

> The route table below is the previous audit snapshot. Its "Not exercised" labels describe that baseline, not the follow-up tests documented below.

Static inventory of Express handlers mounted under `/api/v1`. Route guards, validators, and controller bindings are declared in the linked route source. The integration suite ran against the isolated `smart_bakery_db_test` database.

- Route handlers discovered: **146**
- Previous-audit static request references: **116**, with **30** listed as uncovered
- Follow-up requests: all **30** entries in the original gap table executed; 3 were static-scan false negatives already behavior-tested
- Previous audit backend suite: **96 passed, 0 failed**

A referenced route means a request to that registered method/path appears in a passing test. The test can assert either a success response or an expected denial, validation, or conflict response. This is not a claim that each route has a separate successful business-flow test.

| Method | Registered route | Runtime test coverage | Route source (guards, validators, controller) |
|---|---|---|---|
| GET | /api/v1/alerts | Referenced by passing integration test request | [alert.routes.js](src/routes/alert.routes.js) |
| GET | /api/v1/analytics/sales | Referenced by passing integration test request | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/orders | Not exercised by current integration tests | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/products | Not exercised by current integration tests | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/inventory | Referenced by passing integration test request | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/production | Referenced by passing integration test request | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/wastage | Not exercised by current integration tests | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/satisfaction | Referenced by passing integration test request | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/profitability | Referenced by passing integration test request | [analytics.routes.js](src/routes/analytics.routes.js) |
| GET | /api/v1/analytics/dashboard | Not exercised by current integration tests | [analytics.routes.js](src/routes/analytics.routes.js) |
| POST | /api/v1/auth/register | Referenced by passing integration test request | [auth.routes.js](src/routes/auth.routes.js) |
| POST | /api/v1/auth/login | Referenced by passing integration test request | [auth.routes.js](src/routes/auth.routes.js) |
| POST | /api/v1/auth/refresh | Referenced by passing integration test request | [auth.routes.js](src/routes/auth.routes.js) |
| POST | /api/v1/auth/logout | Referenced by passing integration test request | [auth.routes.js](src/routes/auth.routes.js) |
| GET | /api/v1/auth/me | Referenced by passing integration test request | [auth.routes.js](src/routes/auth.routes.js) |
| PATCH | /api/v1/auth/change-password | Referenced by passing integration test request | [auth.routes.js](src/routes/auth.routes.js) |
| GET | /api/v1/cart | Referenced by passing integration test request | [cart.routes.js](src/routes/cart.routes.js) |
| POST | /api/v1/cart/items | Referenced by passing integration test request | [cart.routes.js](src/routes/cart.routes.js) |
| PATCH | /api/v1/cart/items/:itemId | Not exercised by current integration tests | [cart.routes.js](src/routes/cart.routes.js) |
| DELETE | /api/v1/cart/items/:itemId | Not exercised by current integration tests | [cart.routes.js](src/routes/cart.routes.js) |
| DELETE | /api/v1/cart | Not exercised by current integration tests | [cart.routes.js](src/routes/cart.routes.js) |
| GET | /api/v1/categories | Referenced by passing integration test request | [category.routes.js](src/routes/category.routes.js) |
| GET | /api/v1/categories/:id | Not exercised by current integration tests | [category.routes.js](src/routes/category.routes.js) |
| POST | /api/v1/categories | Referenced by passing integration test request | [category.routes.js](src/routes/category.routes.js) |
| PATCH | /api/v1/categories/:id | Referenced by passing integration test request | [category.routes.js](src/routes/category.routes.js) |
| DELETE | /api/v1/categories/:id | Referenced by passing integration test request | [category.routes.js](src/routes/category.routes.js) |
| POST | /api/v1/complaints | Referenced by passing integration test request | [complaint.routes.js](src/routes/complaint.routes.js) |
| GET | /api/v1/complaints/my | Referenced by passing integration test request | [complaint.routes.js](src/routes/complaint.routes.js) |
| GET | /api/v1/complaints | Not exercised by current integration tests | [complaint.routes.js](src/routes/complaint.routes.js) |
| GET | /api/v1/complaints/:id | Referenced by passing integration test request | [complaint.routes.js](src/routes/complaint.routes.js) |
| PATCH | /api/v1/complaints/:id | Referenced by passing integration test request | [complaint.routes.js](src/routes/complaint.routes.js) |
| POST | /api/v1/costing/estimate | Referenced by passing integration test request | [costing.routes.js](src/routes/costing.routes.js) |
| POST | /api/v1/costing/price-impact | Referenced by passing integration test request | [costing.routes.js](src/routes/costing.routes.js) |
| GET | /api/v1/costing/summary | Not exercised by current integration tests | [costing.routes.js](src/routes/costing.routes.js) |
| POST | /api/v1/feedback | Referenced by passing integration test request | [feedback.routes.js](src/routes/feedback.routes.js) |
| GET | /api/v1/feedback/my | Referenced by passing integration test request | [feedback.routes.js](src/routes/feedback.routes.js) |
| GET | /api/v1/feedback | Referenced by passing integration test request | [feedback.routes.js](src/routes/feedback.routes.js) |
| GET | /api/v1/feedback/:id | Referenced by passing integration test request | [feedback.routes.js](src/routes/feedback.routes.js) |
| PATCH | /api/v1/feedback/:id | Referenced by passing integration test request | [feedback.routes.js](src/routes/feedback.routes.js) |
| GET | /api/v1/health | Referenced by passing integration test request | [health.routes.js](src/routes/health.routes.js) |
| GET | /api/v1/health/ready | Referenced by passing integration test request | [health.routes.js](src/routes/health.routes.js) |
| GET | /api/v1/ingredients | Referenced by passing integration test request | [ingredient.routes.js](src/routes/ingredient.routes.js) |
| GET | /api/v1/ingredients/:id | Referenced by passing integration test request | [ingredient.routes.js](src/routes/ingredient.routes.js) |
| POST | /api/v1/ingredients | Referenced by passing integration test request | [ingredient.routes.js](src/routes/ingredient.routes.js) |
| PATCH | /api/v1/ingredients/:id | Referenced by passing integration test request | [ingredient.routes.js](src/routes/ingredient.routes.js) |
| DELETE | /api/v1/ingredients/:id | Referenced by passing integration test request | [ingredient.routes.js](src/routes/ingredient.routes.js) |
| GET | /api/v1/inventory/value | Referenced by passing integration test request | [inventory.routes.js](src/routes/inventory.routes.js) |
| GET | /api/v1/inventory/low-stock | Referenced by passing integration test request | [inventory.routes.js](src/routes/inventory.routes.js) |
| GET | /api/v1/inventory/expiring | Referenced by passing integration test request | [inventory.routes.js](src/routes/inventory.routes.js) |
| GET | /api/v1/inventory/transactions | Not exercised by current integration tests | [inventory.routes.js](src/routes/inventory.routes.js) |
| GET | /api/v1/inventory/transactions/:ingredientId | Referenced by passing integration test request | [inventory.routes.js](src/routes/inventory.routes.js) |
| POST | /api/v1/inventory/adjustments | Referenced by passing integration test request | [inventory.routes.js](src/routes/inventory.routes.js) |
| GET | /api/v1/inventory/:ingredientId | Referenced by passing integration test request | [inventory.routes.js](src/routes/inventory.routes.js) |
| GET | /api/v1/inventory | Referenced by passing integration test request | [inventory.routes.js](src/routes/inventory.routes.js) |
| GET | /api/v1/notifications | Referenced by passing integration test request | [notification.routes.js](src/routes/notification.routes.js) |
| GET | /api/v1/notifications/unread-count | Not exercised by current integration tests | [notification.routes.js](src/routes/notification.routes.js) |
| PATCH | /api/v1/notifications/read-all | Not exercised by current integration tests | [notification.routes.js](src/routes/notification.routes.js) |
| PATCH | /api/v1/notifications/:id/read | Referenced by passing integration test request | [notification.routes.js](src/routes/notification.routes.js) |
| POST | /api/v1/orders/check-feasibility | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| POST | /api/v1/orders | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| GET | /api/v1/orders/track | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| POST | /api/v1/orders/:id/mark-paid | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| GET | /api/v1/orders/my | Not exercised by current integration tests | [order.routes.js](src/routes/order.routes.js) |
| POST | /api/v1/orders/:id/reorder | Not exercised by current integration tests | [order.routes.js](src/routes/order.routes.js) |
| GET | /api/v1/orders | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| PUT | /api/v1/orders/finished-stock | Not exercised by current integration tests | [order.routes.js](src/routes/order.routes.js) |
| PATCH | /api/v1/orders/:id/status | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| PATCH | /api/v1/orders/:id/confirm-payment | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| PATCH | /api/v1/orders/:id/reject-payment | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| GET | /api/v1/orders/:id | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| POST | /api/v1/orders/:id/cancel | Referenced by passing integration test request | [order.routes.js](src/routes/order.routes.js) |
| POST | /api/v1/payments/webhook | Referenced by passing integration test request | [payment.routes.js](src/routes/payment.routes.js) |
| POST | /api/v1/payments/create | Referenced by passing integration test request | [payment.routes.js](src/routes/payment.routes.js) |
| POST | /api/v1/payments/verify | Referenced by passing integration test request | [payment.routes.js](src/routes/payment.routes.js) |
| GET | /api/v1/payments/:id | Referenced by passing integration test request | [payment.routes.js](src/routes/payment.routes.js) |
| GET | /api/v1/products/:productId/feedback-summary | Not exercised by current integration tests | [product.routes.js](src/routes/product.routes.js) |
| GET | /api/v1/products | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| GET | /api/v1/products/:productId/variants | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| GET | /api/v1/products/:productId/variants/:variantId | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| GET | /api/v1/products/:productId | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| POST | /api/v1/products | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| POST | /api/v1/products/:productId/variants | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| PATCH | /api/v1/products/:productId/variants/:variantId | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| DELETE | /api/v1/products/:productId/variants/:variantId | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| PATCH | /api/v1/products/:productId | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| DELETE | /api/v1/products/:productId | Referenced by passing integration test request | [product.routes.js](src/routes/product.routes.js) |
| POST | /api/v1/production/plans | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| GET | /api/v1/production/plans | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| GET | /api/v1/production/plans/:id | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| PATCH | /api/v1/production/plans/:id | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/plans/:id/check-feasibility | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/plans/:id/approve | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/orders/:id/assign | Not exercised by current integration tests | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| GET | /api/v1/production/batches | Not exercised by current integration tests | [production.routes.js](src/routes/production.routes.js) |
| GET | /api/v1/production/batches/:id | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| PATCH | /api/v1/production/batches/:id | Not exercised by current integration tests | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/accept | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/reject | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/verify | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/start | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/consume | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/complete | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/quality-check | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| GET | /api/v1/production/batches/:id/cost | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/cost/finalize | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/package | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/finalize | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/deliver | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| POST | /api/v1/production/batches/:id/cancel | Referenced by passing integration test request | [production.routes.js](src/routes/production.routes.js) |
| GET | /api/v1/profitability/orders/:id | Referenced by passing integration test request | [profitability.routes.js](src/routes/profitability.routes.js) |
| GET | /api/v1/profitability/batches/:id | Not exercised by current integration tests | [profitability.routes.js](src/routes/profitability.routes.js) |
| GET | /api/v1/profitability/products/:id | Not exercised by current integration tests | [profitability.routes.js](src/routes/profitability.routes.js) |
| GET | /api/v1/profitability/variants/:id | Not exercised by current integration tests | [profitability.routes.js](src/routes/profitability.routes.js) |
| GET | /api/v1/purchases | Referenced by passing integration test request | [purchase.routes.js](src/routes/purchase.routes.js) |
| POST | /api/v1/purchases | Referenced by passing integration test request | [purchase.routes.js](src/routes/purchase.routes.js) |
| GET | /api/v1/purchases/:id | Referenced by passing integration test request | [purchase.routes.js](src/routes/purchase.routes.js) |
| POST | /api/v1/recipes/calculate | Referenced by passing integration test request | [recipe.routes.js](src/routes/recipe.routes.js) |
| POST | /api/v1/products/:productId/variants/:variantId/recipe | Referenced by passing integration test request | [recipe.routes.js](src/routes/recipe.routes.js) |
| GET | /api/v1/products/:productId/variants/:variantId/recipe | Referenced by passing integration test request | [recipe.routes.js](src/routes/recipe.routes.js) |
| PATCH | /api/v1/products/:productId/variants/:variantId/recipe | Referenced by passing integration test request | [recipe.routes.js](src/routes/recipe.routes.js) |
| DELETE | /api/v1/products/:productId/variants/:variantId/recipe | Referenced by passing integration test request | [recipe.routes.js](src/routes/recipe.routes.js) |
| GET | /api/v1/settings/payment-qr | Referenced by passing integration test request | [setting.routes.js](src/routes/setting.routes.js) |
| PUT | /api/v1/settings/payment-qr | Referenced by passing integration test request | [setting.routes.js](src/routes/setting.routes.js) |
| GET | /api/v1/settings/production-capacity | Referenced by passing integration test request | [setting.routes.js](src/routes/setting.routes.js) |
| PUT | /api/v1/settings/production-capacity | Referenced by passing integration test request | [setting.routes.js](src/routes/setting.routes.js) |
| GET | /api/v1/users | Referenced by passing integration test request | [user.routes.js](src/routes/user.routes.js) |
| GET | /api/v1/users/:id | Referenced by passing integration test request | [user.routes.js](src/routes/user.routes.js) |
| PATCH | /api/v1/users/:id/status | Referenced by passing integration test request | [user.routes.js](src/routes/user.routes.js) |
| PATCH | /api/v1/users/:id/role | Referenced by passing integration test request | [user.routes.js](src/routes/user.routes.js) |
| GET | /api/v1/vendors | Referenced by passing integration test request | [vendor.routes.js](src/routes/vendor.routes.js) |
| POST | /api/v1/vendors | Referenced by passing integration test request | [vendor.routes.js](src/routes/vendor.routes.js) |
| GET | /api/v1/vendors/:id | Referenced by passing integration test request | [vendor.routes.js](src/routes/vendor.routes.js) |
| PATCH | /api/v1/vendors/:id | Referenced by passing integration test request | [vendor.routes.js](src/routes/vendor.routes.js) |
| DELETE | /api/v1/vendors/:id | Referenced by passing integration test request | [vendor.routes.js](src/routes/vendor.routes.js) |
| POST | /api/v1/wastage | Referenced by passing integration test request | [wastage.routes.js](src/routes/wastage.routes.js) |
| GET | /api/v1/wastage/summary | Not exercised by current integration tests | [wastage.routes.js](src/routes/wastage.routes.js) |
| GET | /api/v1/wastage | Not exercised by current integration tests | [wastage.routes.js](src/routes/wastage.routes.js) |
| GET | /api/v1/wastage/:id | Not exercised by current integration tests | [wastage.routes.js](src/routes/wastage.routes.js) |
| GET | /api/v1/workers/me/batches | Referenced by passing integration test request | [worker.routes.js](src/routes/worker.routes.js) |
| POST | /api/v1/workers | Referenced by passing integration test request | [worker.routes.js](src/routes/worker.routes.js) |
| GET | /api/v1/workers | Referenced by passing integration test request | [worker.routes.js](src/routes/worker.routes.js) |
| GET | /api/v1/workers/:id | Not exercised by current integration tests | [worker.routes.js](src/routes/worker.routes.js) |
| PATCH | /api/v1/workers/:id | Not exercised by current integration tests | [worker.routes.js](src/routes/worker.routes.js) |
| DELETE | /api/v1/workers/:id | Not exercised by current integration tests | [worker.routes.js](src/routes/worker.routes.js) |
| PATCH | /api/v1/workers/batches/:id/assignment | Not exercised by current integration tests | [worker.routes.js](src/routes/worker.routes.js) |

## Previous API-only audit limits

At the time of the API-only audit, owner and production staff credentials were unavailable and browser automation was not accessible, so browser sessions were not opened. That API run wrote only isolated test-database fixtures and sent no real payment. The later browser pass used temporary fixtures in the configured development database, removed those records after testing, and made no real payment. Current browser and account limitations are recorded below.

## Follow-up: original 30-route gap

Route discovery was confirmed against the current Express route registrations. All 30 original gap entries have passing API test requests; the backend run passed 96 integration scenarios (the `npm test` discovery count was 97 including the test environment setup module). "Successful workflow" means a meaningful successful response and relevant business data were asserted; "validation/error" and "authorization" are marked only where the referenced test asserts those cases. API requests do not count as browser workflows.

| Method and route | Route discovered | Test request executed | Successful workflow tested | Validation/error cases tested | Authorization tested | Browser workflow verified | Exact test reference and result |
|---|---|---|---|---|---|---|---|
| GET /api/v1/analytics/orders | Yes | Yes | Yes | No | Role behavior via manager success | No | `server/tests/phase10.test.js`, analytics role-protection subtest: manager 200. |
| GET /api/v1/analytics/products | Yes | Yes | Yes | No | Role behavior via manager success | No | `server/tests/phase10.test.js`, analytics role-protection subtest: manager 200. |
| GET /api/v1/analytics/wastage | Yes | Yes | Yes | No | Yes | No | `server/tests/phase10.test.js`, analytics role-protection subtest: manager 403, owner 200. |
| GET /api/v1/analytics/dashboard | Yes | Yes | Yes | No | Yes | No | `server/tests/phase10.test.js`, analytics role-protection subtest: manager 403, owner 200. |
| PATCH /api/v1/cart/items/:itemId | Yes | Yes | Yes | Yes | No | No | `server/tests/orders.test.js`, "cart quantity updates, item removal, and clearing preserve totals": quantity 4 updates subtotal; quantity 0 returns 400. |
| DELETE /api/v1/cart/items/:itemId | Yes | Yes | Yes | Yes | No | No | `server/tests/orders.test.js`, "cart quantity updates, item removal, and clearing preserve totals": delete empties cart; repeating returns 404. |
| DELETE /api/v1/cart | Yes | Yes | Yes | No | Yes | No | `server/tests/orders.test.js`, "cart quantity updates, item removal, and clearing preserve totals": clears subtotal; manager denied 403. |
| GET /api/v1/categories/:id | Yes | Yes | Yes | Yes | Yes | No | `server/tests/catalog.test.js`, category detail: customer 200, malformed ID 400, absent ID 404; category CRUD checks role restrictions. |
| GET /api/v1/complaints | Yes | Yes | Yes | Yes | Yes | No | `server/tests/phase10.test.js`, complaint transitions: manager list contains fixture, customer 403, invalid limit 400. |
| GET /api/v1/costing/summary | Yes | Yes | Yes | No | Yes | No | `server/tests/costing.test.js`, costing summary: owner 200 with summary, manager 403. |
| GET /api/v1/inventory/transactions | Yes | Yes | Yes | Yes | Yes | No | `server/tests/inventory.test.js`, transaction listing: owner filter result, customer 403, reversed date range 400. |
| GET /api/v1/notifications/unread-count | Yes | Yes | Yes | No | Yes | No | `server/tests/phase10.test.js`, notifications: recipient count increments, outsider count 0. |
| PATCH /api/v1/notifications/read-all | Yes | Yes | Yes | No | Yes | No | `server/tests/phase10.test.js`, notifications: recipient marks own unread records read; count reaches 0. |
| GET /api/v1/orders/my | Yes | Yes | Yes | No | Yes | No | `server/tests/orders.test.js`, checkout: customer list contains created order; manager 403. |
| POST /api/v1/orders/:id/reorder | Yes | Yes | Yes | No | Yes | No | `server/tests/orders.test.js`, checkout: customer reorder restores quantity and reports unavailable items; manager 403. |
| PUT /api/v1/orders/finished-stock | Yes | Yes | Yes | Yes | Yes | No | `server/tests/orders.test.js`, checkout: owner sets stock preserving reservation; below-reserved conflict 409; customer 403. |
| GET /api/v1/products/:productId/feedback-summary | Yes | Yes | Yes | No | No | No | `server/tests/phase10.test.js`, feedback: customer receives average rating 5 for isolated feedback fixture. |
| POST /api/v1/production/orders/:id/assign | Yes | Yes | Yes | Yes | No | No | `server/tests/production.test.js`, "worker access and active assignment validation": manager assigns order and receives its planned batch. |
| GET /api/v1/production/batches | Yes | Yes | Yes | No | Yes | No | `server/tests/production.test.js`, planned batch list: manager sees planned batch; customer 403. |
| PATCH /api/v1/production/batches/:id | Yes | Yes | Yes | Yes | Yes | No | `server/tests/production.test.js`, planned batch update: notes saved; empty update 400; customer 403. |
| GET /api/v1/profitability/batches/:id | Yes | Yes | Yes | No | No | No | `server/tests/costing.test.js`, profitability: manager response identifies isolated production batch. |
| GET /api/v1/profitability/products/:id | Yes | Yes | Yes | No | No | No | `server/tests/costing.test.js`, profitability: owner response asserts units sold for fixture product. |
| GET /api/v1/profitability/variants/:id | Yes | Yes | Yes | No | No | No | `server/tests/costing.test.js`, profitability: manager response asserts fixture variant result. |
| GET /api/v1/wastage/summary | Yes | Yes | Yes | No | Yes | No | `server/tests/costing.test.js`, wastage: owner summary succeeds and customer is denied 403. |
| GET /api/v1/wastage | Yes | Yes | Yes | No | No | No | `server/tests/costing.test.js`, wastage listing: created isolated record appears in list. |
| GET /api/v1/wastage/:id | Yes | Yes | Yes | Yes | No | No | `server/tests/costing.test.js`, wastage detail: isolated record detail and missing-record 404. |
| GET /api/v1/workers/:id | Yes | Yes | Yes | Yes | Yes | No | `server/tests/production.test.js`, worker lifecycle: manager detail 200, production staff 403, retained inactive detail 200. |
| PATCH /api/v1/workers/:id | Yes | Yes | Yes | Yes | Yes | No | `server/tests/production.test.js`, worker lifecycle: owner phone update succeeds, empty manager update 400. |
| DELETE /api/v1/workers/:id | Yes | Yes | Yes | No | No | No | `server/tests/production.test.js`, worker lifecycle: owner deactivates isolated worker; record remains inspectable. |
| PATCH /api/v1/workers/batches/:id/assignment | Yes | Yes | Yes | No | Yes | No | `server/tests/production.test.js`, batch workflow: assigned staff updates actual hours/task state; manager denied 403. |

The three remaining original "Not exercised" labels in the baseline table for analytics orders/products and product feedback summary were false negatives from the earlier static request scan: tests construct those URLs using a template loop or string concatenation. Their successful API assertions are cited above. The API-only follow-up found no confirmed route defect. Subsequent live browser checks found and fixed two customer UI defects, recorded in the browser section below.

## Live browser and responsive verification

### Method and environment

- Browser automation: Microsoft Edge headless using the browser's built-in Chrome DevTools Protocol (CDP) over a temporary local debugging port. No Playwright/Puppeteer package or project dependency was added. Screenshots were captured to a temporary directory and inspected directly.
- The local frontend homepage and backend health endpoints both returned HTTP 200 before browser inspection. Pages were navigated and rendered in the browser; HTTP status alone was not treated as visual verification.
- Browser testing used the configured `development` environment and `smart_bakery_db` database. The test-created order, its related records, the guest cart, and uniquely identified catalog/stock/recipe fixtures were removed after verification. No production database or real payment was used.

### Account access

The development database contains role records: CUSTOMER (1), OWNER (1), MANAGER (1), OWNER_MANAGER (2), and PRODUCTION_STAFF (2). No owner, manager, or staff login credentials were configured in the local environment, and the `.env` files contain no browser test-account variables. Therefore login was not attempted and the role returned at login could not be checked in the browser. Unauthenticated attempts to open `/owner` and `/production` redirected to `/login` as expected.

To enable the protected journeys in a local PowerShell session, set credentials for existing authorized development users without committing them, then provide the session to the browser test run:

```powershell
$env:BAKERY_TEST_OWNER_EMAIL = 'existing-owner-email'
$env:BAKERY_TEST_OWNER_PASSWORD = 'existing-owner-password'
$env:BAKERY_TEST_MANAGER_EMAIL = 'existing-manager-email'
$env:BAKERY_TEST_MANAGER_PASSWORD = 'existing-manager-password'
$env:BAKERY_TEST_STAFF_EMAIL = 'existing-staff-email'
$env:BAKERY_TEST_STAFF_PASSWORD = 'existing-staff-password'
```

These values were not set here. Do not create or promote accounts to work around this blocker; use existing development accounts and their assigned roles.

### Customer browser workflow

| Workflow | Result |
|---|---|
| Homepage, menu, category browsing | Passed. Rendered the homepage and catalog; selected the temporary audit category and confirmed its products filtered into the menu. Mobile navigation opened at 375px and exposed menu, tracking, basket, sign-in, and registration links. |
| Product availability, price, variant | Passed for the temporary in-stock product: "Test loaf", INR 42, selectable variant, and enabled add control. The pre-existing development catalog item was also available at INR 300. |
| Product images | The pre-existing catalog item has no image URL in development data, and the temporary fixtures intentionally had no image URL. The rendered page showed the `CatalogImage` fallback ("image unavailable" placeholder); there was no broken `<img>` request. Actual product photography could not be verified from available data. |
| Cart add, count, quantity, totals, refresh | Passed. Added one item, increased to two (2 items, INR 600 for the existing INR 300 item; then 2 audit units at INR 42 = INR 84), decreased back to one, and refreshed. Cart quantity, navbar count, and payable total remained consistent. |
| Invalid checkout | Passed. A too-short phone number displayed the inline validation message and did not create an order. |
| Insufficient ingredient stock | Passed with an isolated zero-stock ingredient/recipe fixture: checkout displayed "Order cannot be fulfilled with current ingredient availability"; no login redirect or order creation occurred. |
| Unavailable production capacity | Passed with the existing development item, which has no finished stock or active recipe while production capacity is unconfigured. Checkout showed the capacity configuration requirement and did not create an order. |
| Feasible guest order | Passed with a temporary in-stock finished-product fixture: two units at INR 42 each produced a successful INR 84 guest order. The temporary fixture was removed afterward. |
| UPI payment page | Passed for displayed amount (INR 84) and configured UPI settings. The QR image generated for the configured UPI URI loaded in the browser. The UPI identifier/payee values are intentionally not recorded here. No UPI app link was opened and no transfer was made. |
| Test UTR and payment state | Passed with a synthetic `AUDIT...` reference that was not a real transaction. UI showed "Payment Reference Submitted" and awaiting verification. Database inspection confirmed `PENDING_VERIFICATION` while the order remained `PENDING_PAYMENT`; no payment was authorized. |
| Guest tracking and errors | Passed. Opened tracking from the payment page, refreshed, and confirmed the order view remained available without login. A nonexistent order displayed an inline not-found error and stayed on `/track`. |

### Responsive observations

Widths below are the actual browser viewport widths. Horizontal overflow was measured from the rendered document after the cart layout fix. Customer home, cart, checkout, and tracking pages were opened at every listed width. The owner and production dashboards were not available to inspect without credentials.

| Viewport | Customer pages inspected | Result |
|---:|---|---|
| 375px | Home/menu, cart, checkout, tracking | No horizontal overflow after fix. Cart item, quantity controls, item price, total, and checkout action fit; mobile navigation drawer opened and remained usable. |
| 430px | Home/menu, cart, checkout, tracking | No horizontal overflow. Cart controls and totals visible. |
| 768px | Home/menu, cart, checkout, tracking | No horizontal overflow; content remained within the viewport. |
| 1366px | Home/menu, cart, checkout, tracking | No horizontal overflow; desktop navigation and catalog rendered. |
| 1920px | Home/menu, cart, checkout, tracking | No horizontal overflow; wide layout remained within the viewport. |

### Confirmed defects and retest

1. At 375px, the cart row's inline flex layout expanded the document to 435px and clipped controls, prices, and summary. Added responsive grid placement for the thumbnail, details, quantity controls, and line total in `client/src/pages/public/CartPage.jsx` and `client/src/index.css`. Reopened the cart at 375px and 430px, exercised quantity changes, and confirmed the document width no longer overflowed; all five viewport widths were rechecked.
2. Checkout read `item.price`, but the cart API response exposes `unitPrice` and `lineTotal`. The order overview therefore displayed INR 0 for a INR 300 item. Added `getCartLineTotal` and used it in `client/src/pages/public/CheckoutPage.jsx`; browser retest displayed INR 300 for one INR 300 item and INR 84 for two INR 42 items. Added dependency-free regression coverage in `client/src/utils/cartPricing.test.js`.

No owner/manager or production-staff browser workflow, dashboard layout, or role-specific navigation was verified. The API suite's role and authorization coverage remains API evidence only and does not substitute for those browser journeys.

### Final regression checks

- Backend suite (`npm test`): **97 passed, 0 failed**. Node counted the 96 integration scenarios plus the `test-env.js` setup module.
- Frontend cart-pricing tests: 3 passed, 0 failed (`node --test src/utils/cartPricing.test.js`).
- Frontend lint: passed with 15 existing warnings.
- Production build: passed.

### Authenticated acceptance continuation — 2026-10-11 (Updated)

This continuation verified runtime processes, resolved unfinished cleanup, clarified and corrected the unified role model, ran headless Edge CDP browser acceptance, and expanded regression test coverage.

| Check | Result |
|---|---|
| Runtime services & port inspection | Verified existing backend running as Node PID 9108 on port 5000 (`/api/v1/health` and `/ready` returning HTTP 200, healthy, database connected, uptime > 50 min). Frontend running as Vite PID 20792/8820 on port 5173 (HTTP 200). Microsoft Edge running with remote CDP on port 9224. Reused healthy instances safely without duplicate launches or port conflicts. |
| Guest cart cleanup | Located previous audit cart `6acb76d6a993720aa9dfda7b` (`guestId: guest_1791718519790_n5wgd0e`) and subsequent test re-instantiation `6acb8c9ea993720aa9dfdaa5`. Executed exact guarded document deletions via `deleteOne({ _id, guestId })` and purged browser origin storage via CDP. Confirmed only the genuine customer cart `6aca5f7ea993720aa9dfda5c` remains in `smart_bakery_db.carts`. |
| Development database role inventory | Read-only aggregation against `smart_bakery_db.users`: `CUSTOMER`: 1, `OWNER_MANAGER`: 1, `PRODUCTION_STAFF`: 1. No standalone `OWNER` or `MANAGER` accounts exist in the development database. |
| Role model defect fix (Backend) | Defect identified in `server/src/controllers/user.controller.js`: `getUserById`, `updateUserStatus`, and `updateUserRole` only checked legacy `OWNER` and `MANAGER` and omitted `OWNER_MANAGER`, rejecting `OWNER_MANAGER` with 403 on user detail inspection. Patched all three methods to recognize `OWNER_MANAGER` alongside legacy `OWNER`. |
| Role model defect fix (Frontend) | Defect identified in `client/src/App.jsx`, `client/src/components/Navbar.jsx`, and `client/src/pages/auth/LoginPage.jsx`: a separate `/manager` route and `ManagerDashboard` existed contrary to the single combined dashboard requirement. Unified routes so `/manager` redirects to `/owner` (`OwnerManagerDashboard`), updated `/owner` route guard to `['OWNER_MANAGER', 'OWNER', 'MANAGER']`, unified Navbar links and badges, and aligned login redirects. |
| Backend regression test expansion | Added 4 automated integration tests to `server/tests/auth.test.js`: Test 24 (`OWNER_MANAGER` accessing user detail, user listing, production capacity, inventory valuation), Test 25 (`PRODUCTION_STAFF` accessing assigned batches and strictly denied management, supplier purchases, costing summary, profitability metrics, and payment details), Test 26 (Legacy `MANAGER` accessing user listing but denied owner-only role modification and inventory valuation), and Test 27 (`CUSTOMER` denied management endpoints). |
| Edge CDP browser verification | Executed automated browser acceptance via DevTools Protocol port 9224 across 5 viewport widths (375px, 430px, 768px, 1366px, 1920px) on Home/Menu, Cart, Checkout, and Order Tracking pages. Zero horizontal overflow detected (`hasOverflow: false` for all 20 viewport/page combinations). Zero network errors. Inline tracking error display verified for non-existent order. Unauthenticated route redirects to `/login` verified for `/owner`, `/manager`, `/production`, and `/customer`. |
| Authenticated browser management workflows | **PASSED**. Executed live Edge CDP in-browser testing using verified development credentials for `OWNER_MANAGER` (`rohantonge75@gmail.com`) and `PRODUCTION_STAFF` (`arjun@gmail.com`). Verified full form logins, dashboard and workstation page loads, all 8 management tabs on `/owner`, batch workflow pipeline on `/production`, UI/API role boundary enforcement, and zero horizontal overflow across 375px, 430px, 768px, 1366px, and 1920px viewports. |
| Full regression suite pass | 101 tests passed in backend integration suite (`npm test`), 3 passed in client cart pricing unit tests, 0 lint errors, client Vite build passed. |
| Application and regression changes in this continuation | Fixed `user.controller.js` to recognize `OWNER_MANAGER`; unified client routing in `App.jsx`, `Navbar.jsx`, `LoginPage.jsx` to single `/owner` dashboard; added tests 24-27 in `auth.test.js`; cleaned up audit guest cart. |

### Authenticated browser acceptance results

- **OWNER_MANAGER Workflow**: Successfully authenticated via Edge CDP login form as `rohantonge75@gmail.com`. Verified redirect to `/owner`, verified greeting and user role badge (`OWNER / MANAGER`), verified overview metrics (4 cards, live QR card). Inspected all 8 tabs (`overview`, `orders`, `products`, `inventory`, `production`, `staff`, `analytics`, `qr`). Verified token API authorization (`/api/v1/orders`, `/api/v1/inventory/value`, `/api/v1/costing/summary`, `/api/v1/analytics/profitability`, `/api/v1/users`, `/api/v1/purchases` all returned HTTP 200). Verified responsive rendering across 375px, 430px, 768px, 1366px, and 1920px viewports (zero overflow, mobile sidebar drawer functional).
- **PRODUCTION_STAFF Workflow**: Successfully authenticated via Edge CDP login form as `arjun@gmail.com`. Verified redirect to `/production`, verified header (`Today’s Kitchen Tasks`), verified user role badge (`PRODUCTION STAFF`), verified batch list and 8-step pipeline controls. Verified responsive rendering across 375px, 430px, 768px, 1366px, and 1920px viewports (zero overflow).
- **Role Boundary & Privacy Enforcement**:
  - UI Navigation: Staff navigation to `/owner` intercepted and redirected back to `/production`.
  - API Authorization: Direct requests using Staff token to owner-only endpoints strictly returned HTTP 403 Forbidden (`/api/v1/purchases`, `/api/v1/costing/summary`, `/api/v1/analytics/profitability`, `/api/v1/payments/:id`, `/api/v1/users`, `/api/v1/inventory/value`, `/api/v1/settings/production-capacity`).
  - Customer Privacy: Unauthenticated/cross-customer access to orders denied (HTTP 401/403).
  - Manual Payment Safeguard: UTR reference submission transitions order payment to `PENDING_VERIFICATION` while order remains `PENDING_PAYMENT`; payment authorization strictly requires explicit owner verification.

### Final verification suite counts

- **Backend Integration Test Suite** (`npm test` in `server`): **101 passed, 0 failed** (exit code `0`).
- **Client Pricing Unit Tests** (`node --test src/utils/cartPricing.test.js` in `client`): **3 passed, 0 failed** (exit code `0`).
- **Client Linting** (`npm run lint` in `client`): **0 errors**, 11 compiler warnings (all informational React compiler optimization advice, exit code `0`).
- **Client Production Build** (`npm run build` in `client`): **Clean exit, 0 errors** (exit code `0`).
- **Repository Diff Check** (`git diff --check`): **Clean exit, 0 errors** (exit code `0`).
- **In-Browser Acceptance Suite** (CDP Edge runner): **4/4 core criteria PASSED** (exit code `0`).
