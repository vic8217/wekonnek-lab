# Stage 0A Authorization Matrix

Authentication alone is insufficient. Ownership / assignment must hold.

| Actor | read | transition | assign_rider | unassign_rider | record_payment_collection | cancel |
|-------|------|------------|--------------|----------------|---------------------------|--------|
| CUSTOMER | own order only | no | no | no | no | pending/confirmed only |
| MERCHANT_OWNER | own merchant/shop | merchant prep path* | yes | yes | yes | yes |
| MERCHANT_ADMIN | own merchant/shop | merchant prep path* | yes | yes | yes | yes |
| MERCHANT_STAFF | own merchant/shop | limited prep path* | no | no | no | limited |
| RIDER | actively assigned only | picked_up → in_transit → delivered | no | no | no | no |
| SYSTEM_ADMIN | all | yes | yes | yes | yes | yes |
| PAYMENT_PROVIDER | no | no | no | no | yes (trusted callback) | no |
| INTERNAL_SERVICE | all | yes | yes | yes | yes | yes |
| SYSTEM | all | yes | yes | yes | yes | yes |

\* Merchant transitions: `confirmed`, `preparing`, `ready_for_pickup`, `rider_assigned`, `cancelled` — not rider custody steps.

Code: `src/fulfillment/fulfillment-authorization.ts` (`FULFILLMENT_AUTH_MATRIX`, `assertOperationAllowed`).

**Terra:** wire JWT role + merchant membership + active rider checks into REST/WebSocket controllers so they pass the correct `AuthActor` into `FulfillmentTransitionService` (today `delivery-orders` still calls with `SYSTEM` for backward compatibility).
