# WeKonnek ↔ ACCURA integration

Official Philippine e-invoice issuance for marketplace `WkOrder` rows.
ACCURA remains the invoice authority. WeKonnek remains the commerce and
payment authority.

## Machine endpoint

`POST {ACCURA_API_BASE_URL}/api/v1/integrations/invoices`

Implemented by `AccuraClientService.issueInvoiceForOrder(wkOrderId)`.

## Auth configuration

Marketplace issuance authenticates as an ACCURA **PLATFORM** IntegrationClient:

```
Authorization: Basic base64(ACCURA_PLATFORM_CLIENT_ID:ACCURA_PLATFORM_CLIENT_SECRET)
```

Required environment for WeKonnek marketplace invoice issuance:

| Variable | Purpose |
|---|---|
| `ACCURA_API_BASE_URL` | ACCURA origin, no trailing slash needed |
| `ACCURA_PLATFORM_CLIENT_ID` | PLATFORM IntegrationClient id |
| `ACCURA_PLATFORM_CLIENT_SECRET` | PLATFORM API secret (shown once; never in the browser) |
| `ACCURA_SERIES_ID` | ACCURA `NumberSeries` id sent as `seriesId` (must belong to the delegated company) |
| `ACCURA_API_TIMEOUT_MS` | Bounded HTTP timeout. Default `10000` |

Legacy single-company variables (not used for marketplace issuance):

| Variable | Purpose |
|---|---|
| `ACCURA_INTEGRATION_CLIENT_ID` | COMPANY IntegrationClient (`invoice:create`) |
| `ACCURA_INTEGRATION_CLIENT_SECRET` | COMPANY API secret |
| `ACCURA_BRANCH_ID` | COMPANY-bound branch. Marketplace uses `ShopAccuraBranchMapping` instead |

Do not put `ACCURA_PLATFORM_CLIENT_SECRET` in job payloads, logs, or frontend env.

ACCURA SYSTEM_ADMIN must grant the PLATFORM client:

- `platform-invoice:create`
- plus Task 3B onboarding scopes (`platform-client:create/read`, `platform-client-profile:read/write`, `platform-client-documents:write`, `platform-client-onboarding:submit`)

WeKonnek does not grant scopes.

## Delegated marketplace issuance

```
WEKONNEK PLATFORM CLIENT
      ↓
Merchant externalClientReference = merchant-<merchantId>
      ↓
ACCURA IntegrationPlatformDelegation (active)
      ↓
ACCURA Company
      ↓
invoice
```

Canonical helper: `accuraExternalClientReference` / `getAccuraExternalClientReference` (same function). Onboarding and issuance share it. Company is never sent as `companyId`.

Order merchant comes from `WkOrder.merchantId`. Shop mapping:

`WkOrder.shopId` → merchant-owned `ShopAccuraBranchMapping` → ACCURA `branchId`.

A WeKonnek Shop is not an ACCURA/BIR branch. Missing or cross-merchant mapping fails the issuance job (`REJECTED`, not retryable). Payment stays `paid`. There is no default-branch fallback.

`ACCURA_SERIES_ID` remains required by ACCURA `issueReceipt`. ACCURA allocates the official number from that series only if the series belongs to the delegated company.

## Webhook endpoint

`POST /api/integrations/accura/webhooks`

Public from JWT. Authenticated by HMAC + timestamp + `ACCURA_WEBHOOK_SECRET`.

Headers:

- `X-Accura-Event-Id`
- `X-Accura-Timestamp` (unix seconds)
- `X-Accura-Signature` (`v1=<hex>`)

HMAC-SHA256 over `timestamp + "." + exact raw body`. Tolerance default 300s
(`ACCURA_WEBHOOK_TOLERANCE_SECONDS`). PLATFORM `invoice.issued` payloads may
include additive `data.externalClientReference`. Order matching remains
`externalOrderId` → `WkOrder.id`. The reference is only a mismatch check
against `merchant-<WkOrder.merchantId>`; it never selects the order.

## Order mapping

| ACCURA field | WeKonnek source |
|---|---|
| `sourceSystem` | always `WEKONNEK` |
| `externalClientReference` | `merchant-<WkOrder.merchantId>` |
| `branchId` | `ShopAccuraBranchMapping.accuraBranchId` |
| `externalOrderId` | `String(WkOrder.id)` |
| `externalOrderCode` | `WkOrder.orderCode` |
| line items | persisted `OrderItem` name/qty/unit price |
| delivery | extra line `"Delivery fee"` when `deliveryFee > 0` |
| transaction fee | **not** sent as merchandise |
| buyer | only stored user name/phone/email and delivery address |
| payment | method/status/reference snapshot; `processor=WEKONNEK` |
| `taxClass` | `NON_VAT` (no tax snapshot on `WkOrder`) |

Seller legal identity, official invoice number, `documentHash`, `issuedAt`,
VAT, and authoritative totals are **not** assigned by WeKonnek.

## Idempotency key

Deterministic per order:

```
wekonnek:wkorder:<WkOrder.id>:accura-invoice
```

Sent as the `Idempotency-Key` header and `idempotencyKey` body field.
Retries of the same order reuse this key. A changed payload with the same key
is rejected by ACCURA as `409 IDEMPOTENCY_KEY_REUSED`.

## Payment / issuance separation

Verified gateway settlement commits first via `OrdersService.markPaidByGateway`
(PayCools `settleVerified` and other gateway webhooks that already call it).
The payment transaction writes `paymentStatus=paid` and inserts one
`AccuraIssuanceJob` in the **same database transaction**. ACCURA HTTP is
**not** called inside that transaction.

`npm run worker:accura-issuance` claims due jobs, calls
`AccuraClientService.issueInvoiceForOrder(wkOrderId)` with the deterministic
key `wekonnek:wkorder:<id>:accura-invoice`, and records success/retry/failure
on the job. `WkOrderAccuraInvoice` is still attached only by the
`invoice.issued` webhook.

An ACCURA timeout, 429, or 5xx leaves `WkOrder.paymentStatus`, `status`,
PayCools rows, delivery fields, and transaction-fee snapshots unchanged.
The issuance job moves to `RETRY_SCHEDULED`.

Eligible automatic enqueue:

- real `WkOrder`
- verified paid/settled (`paymentStatus = paid` after settlement)
- no existing `WkOrderAccuraInvoice`
- one job per `wkOrderId` (unique)

Cash/COD/manual completion that never goes through `markPaidByGateway` is
not auto-enqueued. Those orders remain eligible for an explicit
`issueInvoiceForOrder` call when `paymentStatus=paid` or cash/COD is
`completed`/`delivered`.

Unpaid newly created orders are not issued and do not receive a job.

Admin read model (does not change `paymentStatus`):

- `PAID / INVOICE PENDING`
- `PAID / INVOICE ISSUED`
- `PAID / INVOICE FAILED`

Manual retry: `POST /api/integrations/accura/issuance/jobs/:jobId/retry`
(admin JWT). Resets the same job to `PENDING`. Same idempotency key.

## Failure handling

| ACCURA result | WeKonnek classification | Retryable |
|---|---|---|
| 201 ISSUED | `ISSUED` | no |
| 401 / 403 | `AUTH` | no |
| 409 `IDEMPOTENCY_KEY_REUSED` | `IDEMPOTENCY_CONFLICT` | no |
| 429 | `RATE_LIMITED` | yes |
| 5xx | `SERVER` | yes |
| timeout / network | `TIMEOUT` / `NETWORK` | yes |

Durable worker:

```
npm run worker:accura-issuance
```

Poll / batch / lease / max attempts:

| Variable | Default |
|---|---|
| `ACCURA_ISSUANCE_WORKER_POLL_MS` | `2000` |
| `ACCURA_ISSUANCE_BATCH_SIZE` | `10` |
| `ACCURA_ISSUANCE_PROCESSING_LEASE_SECONDS` | `300` |
| `ACCURA_ISSUANCE_MAX_ATTEMPTS` | `6` |

Retry delays after failed attempts: 1m, 5m, 15m, 1h, 6h, then `FAILED`.
401/403, permanent 4xx, and `IDEMPOTENCY_KEY_REUSED` are terminal.
Stale `PROCESSING` rows older than the lease are reclaimable.

## Webhook HMAC and attachment

The webhook receiver is the durable attachment mechanism:

`invoice.issued` → `AccuraWebhookEvent` (unique `eventId`) → one
`WkOrderAccuraInvoice` per `WkOrder`.

The synchronous issuance response is confirmation only. It does not overwrite
`WkOrderAccuraInvoice`.

Unknown `externalOrderId`: HTTP 404, no rows. ACCURA treats other 4xx as
permanent (`PERMANENT_HTTP_4XX`) and will not retry.

A second official invoice for the same order: HTTP 409, existing association
unchanged.

## Secret separation

Never reuse:

- `ACCURA_WEBHOOK_SECRET` for machine Basic auth
- `ACCURA_PLATFORM_CLIENT_SECRET` or `ACCURA_INTEGRATION_CLIENT_SECRET` for webhook HMAC
- PayCools, JWT, or BIR secrets for either

Logs include `wkOrderId`, `orderCode`, `accuraInvoiceId`,
`accuraInvoiceNumber`, `eventId`, and result only.

## Sandbox setup

1. Run ACCURA locally (see ACCURA Task 5A). Create an integration client with
   `invoice:create`, configure webhook URL, rotate webhook secret.
2. Set the WeKonnek placeholders in `.env` (no production values).
3. Create a paid sandbox `WkOrder` (PayCools settlement enqueues a job).
4. Run `npm run worker:accura-issuance`, or call
   `AccuraClientService.issueInvoiceForOrder(wkOrderId)` directly.
5. ACCURA worker delivers `invoice.issued` to
   `/api/integrations/accura/webhooks`.
6. Confirm one `WkOrderAccuraInvoice` and job status `SUCCEEDED`.

ACCURA rejects `localhost` webhook URLs. Local round-trip tests therefore
issue against a mocked or sandbox ACCURA HTTP endpoint and deliver the
resulting `invoice.issued` payload to the WeKonnek receiver with the real
HMAC contract.

## ACCURA worker dependency

Webhook delivery on the ACCURA side requires:

```
npm run worker:webhooks
```

Issuance still succeeds and enqueues `WebhookEvent` / `WebhookDelivery` even
if the worker is down. The worker later posts to WeKonnek. WeKonnek does not
run the ACCURA worker.

## Merchant Tax Registration / E-Receipt Setup

WeKonnek Merchant Admin is the onboarding UI. ACCURA remains authoritative
for taxpayer/e-receipt registration. WeKonnek does not store a second
`taxProfile` and does not claim BIR approval.

Navigation: Merchant Admin → Settings → E-Receipt / Tax Setup  
(`/merchant/settings/e-receipt`). Customers, coordinators, and the shop
portal cannot use this page.

### Platform vs invoice credentials

WeKonnek marketplace onboarding **and** invoice issuance use one PLATFORM
IntegrationClient:

- `ACCURA_PLATFORM_CLIENT_ID`
- `ACCURA_PLATFORM_CLIENT_SECRET`

`ACCURA_INTEGRATION_CLIENT_ID` / `ACCURA_INTEGRATION_CLIENT_SECRET` are the
legacy COMPANY credential (one ACCURA company). They are not used for
normal multi-merchant issuance.

The PLATFORM client cannot use `invoice:create`. Delegated invoices require
`platform-invoice:create`. Machine secrets stay on the WeKonnek backend.
Browser JavaScript never calls ACCURA with a client secret.

Delegated identity:

```
externalClientReference = merchant-<WeKonnek merchant id>
```

Company identity is never sent as `companyId`. ACCURA resolves
platform client + reference → delegated Company.

Required ACCURA scopes (Task 3A names):

- `platform-client:create`
- `platform-client:read`
- `platform-client-profile:read`
- `platform-client-profile:write`
- `platform-client-documents:write`
- `platform-client-onboarding:submit`
- `platform-invoice:create`

WeKonnek browser routes (JWT merchant):

| Method | Path |
|---|---|
| GET/PATCH | `/api/integrations/accura/onboarding/profile` |
| GET | `/api/integrations/accura/onboarding/readiness` |
| GET/POST | `/api/integrations/accura/onboarding/branches` |
| PATCH | `/api/integrations/accura/onboarding/branches/:branchId` |
| POST | `/api/integrations/accura/onboarding/shop-mappings` |
| GET/POST | `/api/integrations/accura/onboarding/documents` |
| POST | `/api/integrations/accura/onboarding/submit` |

A WeKonnek Shop is not automatically a BIR registered branch. Shop ↔ ACCURA
branch mapping is explicit, merchant-scoped, and required before marketplace
invoice issuance. Missing mapping fails the job without rolling back payment.
ACCURA remains final enforcement for branch ownership
(`BRANCH_NOT_OWNED_BY_DELEGATED_CLIENT`).

Documents are proxied to ACCURA as `multipart/form-data`. WeKonnek checks
magic bytes and size, does not keep a duplicate file, and never returns
`storageKey` to the browser.

### UAT flow

1. Create an ACCURA PLATFORM IntegrationClient with the platform-client
   scopes above **and** `platform-invoice:create`. Put the id/secret in
   WeKonnek `ACCURA_PLATFORM_*` only. Configure the platform webhook with
   `ACCURA_WEBHOOK_SECRET` (never the API secret).
2. Sign in as a WeKonnek merchant (not shop portal, not coordinator).
3. Open **E-Receipt / Tax Setup**. Review prefilled WeKonnek values.
4. Save registered business information and tax classification. Status stays
   Incomplete until ACCURA readiness is complete.
5. Add actual registered taxpayer branches. Map WeKonnek shops only when
   the merchant chooses a registered branch.
6. Upload a Certificate of Registration or other tax registration document
   (PDF/JPG/PNG, max 10 MB).
7. When ACCURA reports setup complete, click **Submit for ACCURA Review**.
8. In ACCURA System Admin, open Tax Registrations. Request correction or
   approve. Optional `activate: true` is an ACCURA System Admin action only.
9. Refresh WeKonnek. Expected labels: Incomplete, Submitted, Under Review,
   Needs Correction, or **Approved for ACCURA E-Receipt Setup**. Never
   “BIR Approved”. If the ACCURA company is ACTIVE, WeKonnek also shows
   **E-Receipt Issuance: ACTIVE**. If SUSPENDED, WeKonnek shows
   **ACCURA E-Receipt Account Suspended** and does not pretend issuance is
   available.
10. Place a paid sandbox order after mapping the WeKonnek shop to the
    ACCURA registered branch. Path:
    paid `WkOrder` → `AccuraIssuanceJob` → PLATFORM
    `POST /api/v1/integrations/invoices` with `externalClientReference`
    `merchant-<id>` → `invoice.issued` webhook → `WkOrderAccuraInvoice`.

If ACCURA is down, WeKonnek does not mark submit successful, does not
fabricate APPROVED, and may show last-known status as temporarily
unavailable. Saved WeKonnek merchant profile data is not lost.
