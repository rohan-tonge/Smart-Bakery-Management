# Phase 11: Production Readiness

This phase hardens the existing backend and documents deployment. It does not deploy the service or add business functionality. The API remains an Express application at `/api/v1` backed by MongoDB.

## Environment variables

Copy `.env.example` to `.env` for local development. Never commit `.env` or pass secrets as Docker build arguments.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | `development`, `test`, or `production`. Production enables secure refresh cookies and strict configuration checks. |
| `PORT` | HTTP listen port (default `5000`). |
| `MONGO_URI`, `MONGO_DB_NAME` | MongoDB connection and selected database. |
| `ACCESS_TOKEN_SECRET`, `REFRESH_TOKEN_SECRET` | Separate JWT signing keys. Production requires unique, non-placeholder values of at least 32 characters. |
| `ACCESS_TOKEN_EXPIRES_IN`, `REFRESH_TOKEN_EXPIRES_IN` | JWT expiration strings (defaults `15m`, `7d`). |
| `COOKIE_SECRET` | Cookie parser signing secret; production requires its own 32+ character secret. |
| `CORS_ORIGIN`, `FRONTEND_URL` | Explicit browser origins. Production requires HTTPS origins and rejects `*`. Comma-separated origins are supported. |
| `TRUST_PROXY_HOPS` | Number of trusted proxy hops. Keep `0` unless the app is behind a known, correctly configured proxy chain. |
| `LOG_LEVEL` | Pino level; default `info` in production and `debug` otherwise. |
| `ORDER_RESERVATION_MINUTES` | Existing order reservation setting. |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Optional payment settings. Test mode uses a `rzp_test_` key. Production can use test credentials until live credentials are separately provisioned. |
| `RAZORPAY_CURRENCY`, `RAZORPAY_API_BASE_URL` | Provider currency and HTTPS API base URL. |

Production also requires explicit HTTPS values for both CORS origin variables (they may be the same). Configure secrets through the hosting platform's secret manager. Startup fails for missing/weak production secrets or invalid production CORS settings.

## Local setup and tests

1. Install a supported Node.js release and MongoDB.
2. Start MongoDB and configure `MONGO_URI` / `MONGO_DB_NAME`.
3. Copy `.env.example` to `.env`; replace development JWT secrets with random values before sharing the environment.
4. From `server/`, run `npm ci`, `npm test`, then `npm run dev`.

The test script runs Node's test runner serially (`--test-concurrency=1`). The integration suite requires the configured MongoDB test database and does not need Razorpay credentials or external APIs; provider calls are stubbed in tests. Do not point tests at a production database.

## Production configuration

- Set `NODE_ENV=production`, unique random secrets, an explicit port, MongoDB URI, and HTTPS CORS origins.
- Refresh cookies are HttpOnly, Secure in production, SameSite Strict in production and Lax in development, scoped to `/`, with maxAge matching the configured refresh-token lifetime (default `7d`). Keep the frontend and API on the same site if using Strict cookies. TLS must terminate at the public edge.
- Helmet is enabled. JSON and URL-encoded request bodies are limited to 10 MB. Global rate limits allow up to 300 requests per 15 minutes per client IP; register/login/refresh have an additional 20-per-15-minute limit. In-memory limits are per process and are not shared across replicas.
- Use `TRUST_PROXY_HOPS` only when the edge proxy strips/replaces forwarded headers and the hop count matches the actual topology. Incorrect proxy trust can let clients spoof IPs and bypass rate limits.
- Error responses use the standard API envelope; production masks server errors. Request logs omit headers and query strings. Error logs retain error type/code, not raw database/provider error messages.
- `GET /api/v1/health` is a liveness check. `GET /api/v1/health/ready` returns 503 when MongoDB is disconnected and does not reveal connection details.

## MongoDB, transactions, and inventory recovery

The local standalone MongoDB setup does not support multi-document transactions. Inventory operations use a real Mongoose transaction only when the connected topology is a replica set or sharded cluster. On standalone MongoDB, the inventory service executes compensating rollback logic after an operation fails; rollback failure is logged and surfaced as an internal error requiring reconciliation. Compensation is not equivalent to atomic transactions and a process/host crash between writes can still require manual stock reconciliation.

For production workflows that require true multi-document atomicity, use a properly operated MongoDB replica set or sharded cluster and test transaction behavior there. Keep scheduled backups, enable point-in-time recovery where available, and regularly rehearse restoring the database. Preserve inventory transaction history during any manual correction.

Production batch transitions and cost finalization use state guards/conditional writes, and wastage writes coordinate with finalization through batch write-claim state. If a process dies while holding a claim, inspect the batch and related inventory/audit records before clearing stale state. Do not blindly replay a stock-changing request; first verify its inventory transactions and idempotency key.

## Payments and webhook

Local/tests do not require Razorpay keys. In development only `rzp_test_` key IDs are accepted. Set all three Razorpay values to enable the provider integration; provider secrets are not returned by the API. Live credentials should only be enabled after the merchant has configured the production account and webhook URL independently. Webhook signatures are checked against the captured raw request bytes. Ensure the reverse proxy forwards the body and `X-Razorpay-Signature` and `X-Razorpay-Event-Id` headers unchanged.

## Docker

Build from `server/` with `docker build -t smart-bakery-api .`, then run with runtime environment variables/secrets and a reachable MongoDB service. The image uses Node 22 Alpine, installs production dependencies only, runs as the unprivileged `node` user, and copies only `src`; `.env` is excluded from the build context. The container does not bundle MongoDB or credentials. Mount or inject configuration at runtime. A deployment platform can use `/api/v1/health/ready` for readiness and `/api/v1/health` for liveness.

No compose file is included because a local standalone database can mislead operators into assuming transactions are available.

## Operations

- The server stops accepting new connections on SIGINT/SIGTERM, waits for active requests for up to 10 seconds, closes MongoDB, then exits. Fatal unhandled errors exit nonzero after shutdown.
- Send Pino output to the platform's protected log sink. Restrict log access and retention; alert on repeated startup/database failures, 5xx responses, failed payment processing, and rollback/reconciliation errors.
- Monitor database health, connection capacity, disk, backup freshness, API latency, and rate-limit volume. The application does not include a monitoring agent or distributed tracing platform.
- Keep dependencies patched through reviewed lockfile updates. `npm audit` requires registry access and was not used as a basis for automatic upgrades in this phase.

## Scope and known limitations

- No image upload route or file upload handling exists. Upload-specific MIME, extension, size, and path-traversal controls remain outside current scope; the unused Multer dependency was removed.
- No OpenAPI/Swagger definition currently exists. The route files, validators, and this deployment guide are the current API/configuration references; endpoint-level OpenAPI coverage remains a documentation limitation.
- Feedback/analytics historical grouping may load selected historical records into application memory; high-volume deployments should measure and consider database-side aggregation after an operational capacity review.
- Rate limiting is process-local. Multiple app replicas need an appropriately shared limiter store before relying on aggregate per-client quotas.
- MongoDB standalone compensation is best-effort and cannot guarantee multi-document atomicity under process/host failure.
- This guide does not claim that the application has been deployed or that all security risks are eliminated.

## Deployment checklist

- [ ] Production secrets are unique, random, and injected at runtime.
- [ ] MongoDB URI uses TLS/authentication and a least-privilege application user.
- [ ] Backups and restore procedures are tested.
- [ ] Production frontend origins are explicit HTTPS values; proxy hop count is verified.
- [ ] TLS and cookie behavior are verified from the deployed frontend origin.
- [ ] Razorpay webhook URL, secret, and test/live mode are checked independently.
- [ ] `/health` and `/health/ready` are configured in the hosting platform.
- [ ] Graceful termination has enough platform drain time for the 10-second shutdown window.
- [ ] Logs, rate limits, database capacity, and reconciliation alerts are monitored.
- [ ] `npm test` passes against a non-production test database.
