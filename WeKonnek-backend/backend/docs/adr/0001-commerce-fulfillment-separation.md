# ADR 0001 — Commerce / Fulfillment Separation (Stage 0A)

- **Status:** Accepted
- **Date:** 2026-09-15
- **Stage:** 0A (architectural foundation only)
- **Owners:** Cursor (schema + domain services); Terra (endpoint/WebSocket/security wiring)

## Current architecture

WeKonnek has two order stacks:

1. **`WkOrder` (`orders`)** — canonical marketplace commerce order used by checkout, merchant/customer UI, RFQ conversion, Trust Trade, PayCools/platform payments, fees, Accura, dine-in. Status and payment fields are free-form strings with soft checks only.
2. **`Order` (`orders_v2`)** — delivery/express fulfillment lifecycle with Prisma `OrderStatus`, rider assignment, delivery PIN/proof fields. Auth is JWT-only; assignment overwrites `riderId`; no transition audit; not linked to marketplace checkout.

`OrderDomainLink` and `TrustTradeTransaction.orderV2Id` exist as scaffolding but are unused for runtime bridging.

## Problems

- Dual stacks without a defined relationship risk divergent lifecycle rules.
- Critical transitions can be implemented differently by REST vs WebSocket vs future QR.
- `riderId` overwrite lacks history, reassignment reason, and concurrency protection.
- Free-form `WkOrder.status` cannot safely encode fulfillment custody.
- COD/cash/manual payment is marked `paid` when status becomes `completed`/`delivered`, conflating fulfillment with payment collection.
- Authorization is ownership-aware on marketplace orders but nearly absent on delivery-orders.

## Options considered

### Option A — Make `WkOrder` the complete canonical order

Migrate rider/PIN/proof/lifecycle into `WkOrder`.

- **Pros:** One table; simpler mental model.
- **Cons:** High migration risk across checkout, RFQ, Trust Trade, PayCools, Accura, merchant UI; mixes commerce and custody; Int PK vs UUID rider ecosystem friction; large blast radius.

### Option B — `WkOrder` commerce + linked fulfillment aggregate (preferred)

Keep `WkOrder` as commerce source of truth; introduce/own a fulfillment domain for rider operations that references the commerce order. Keep `orders_v2` as a legacy/parallel fulfillment carrier during Stage 0.

- **Pros:** Protects checkout/RFQ/Trust Trade/payments; matches future custody, Rider Advance, and verified pickup/delivery; additive migrations; clear payment vs fulfillment boundary.
- **Cons:** Two aggregates to reason about; temporary dual fulfillment carriers (`OrderFulfillment` + `orders_v2`) until express stack is absorbed or retired.

### Option C — New unified architecture replacing both

- **Pros:** Clean end state.
- **Cons:** Highest production risk; unnecessary for Stage 0; breaks backward compatibility.

## Chosen architecture

**Option B.**

| Domain | Aggregate | Owns |
|--------|-----------|------|
| Commerce | `WkOrder` | Customer, merchant, shop, items, prices, fees, payment references, RFQ, Trust Trade |
| Fulfillment | `OrderFulfillment` (canonical for marketplace delivery) + legacy `orders_v2` carrier | Rider assignment/history, pickup, custody, in-transit, delivery evidence, fulfillment status |

All critical fulfillment transitions must go through **`FulfillmentTransitionService`** (REST / WebSocket / future QR / rider app → same service → validation + authorization + state change + audit).

## Data relationship

```
WkOrder (orders)
   │ 1:0..1
   ▼
OrderFulfillment (order_fulfillments)
   │ 1:N
   ├── RiderAssignment (rider_assignments)
   └── OrderDomainEvent (order_domain_events)

orders_v2 (legacy express/delivery)
   │ optional bridge
   ├── OrderFulfillment.orderV2Id (when wrapped)
   ├── OrderDomainLink (existing scaffolding)
   └── OrderDomainEvent (via transition service)
```

- `OrderFulfillment.wkOrderId` is the primary commerce link (unique when set).
- `OrderFulfillment.orderV2Id` optionally wraps an existing `orders_v2` row without deleting it.
- Payment status remains on `WkOrder` / platform payment tables — **not** derived from fulfillment delivery alone (except documented legacy COD path).

## State machine (fulfillment)

Server-authoritative statuses:

`pending → confirmed → preparing → ready_for_pickup → rider_assigned → picked_up → in_transit → delivered`

Cancel allowed from non-terminal pre-pickup/in-progress states as defined in code. Terminal: `delivered`, `cancelled`.

Future (not implemented in 0A): verified pickup between `rider_assigned` and `in_transit`; verified delivery before terminal `delivered`.

## Migration strategy

1. Additive Prisma migration: fulfillment, assignment history, domain events, concurrency version on `orders_v2`.
2. Introduce domain module; route `delivery-orders` status/assign through transition + assignment services.
3. Provide `ensureFulfillmentForWkOrder` for marketplace delivery without forcing create on every checkout.
4. Isolate legacy COD auto-paid-on-complete; emit domain event; do not redesign merchant payments.
5. Later stages: absorb or retire `orders_v2` usage for merchant delivery; Terra hardens HTTP/WS auth.

## Backward compatibility

- Checkout, RFQ, Trust Trade, PayCools, Accura, merchant/customer order UIs unchanged in behavior.
- `orders_v2` table retained; existing rows valid.
- COD still marks `paymentStatus=paid` on `completed`/`delivered` via explicit legacy helper (documented).
- No destructive deletes of order stacks.

## Rollback strategy

1. Stop routing new code paths (feature flag / revert deploy).
2. Drop new tables/columns via reverse SQL documented in the migration folder (`rollback.sql`) — only if no production dependents exist.
3. Restore previous `OrdersService` assignment/status methods if needed.
4. Legacy COD behavior remains even after rollback of fulfillment tables.

## Risks

- Temporary dual fulfillment carriers confuse callers until Terra consolidates endpoints.
- Incomplete endpoint auth until Terra Stage 0B.
- Legacy COD path continues to blur payment/fulfillment until merchant payment redesign.
- Express `orders_v2` still uses `Store` not `Merchant`.

## Future compatibility

| Initiative | Fit |
|------------|-----|
| Trust Trade 2.0 | Commerce remains on `WkOrder`; custody evidence attaches to fulfillment + domain events |
| Rider Advance | Assignment history + versioned active rider is the prerequisite; no finance in 0A |
| Pickup QR / custody | Transition service is the single gate for verified pickup → `in_transit` |
| Customer delivery confirmation | Same gate for verified delivery; PIN/proof fields reserved on fulfillment |
| Rider reimbursement | Out of scope; assignment identity is available later |

## Explicit non-goals (Stage 0A)

Merchant QR banks, PayCools routing fixes, Bazaar/Property payments, Rider Advance, Trust Trade 2.0, pickup QR, vendor payment ack, customer OTP, rider reimbursement/settlement.
