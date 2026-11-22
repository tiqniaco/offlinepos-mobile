# Offers & coupons (Phase 5)

Engine: `packages/shared/src/offers.ts` (pure, tested in `test/offers.test.ts`) · storage: `apps/mobile/src/domain/offers/offers.ts`.

| Type | Meaning | Fields |
|---|---|---|
| PERCENT | % off the line | valueBp, minQtyMilli (base units) |
| FIXED | amount off per **base** unit | valueMinor, minQtyMilli |
| BUY_X_GET_Y | buy X get Y (free or % off), counted in base units (a carton of 12 = 12) | buyQtyMilli, getQtyMilli, valueBp (10000 = free), getProductId (optional other product) |
| QTY_PRICE | unit price from a quantity (tiers), quantity summed per product over all its lines | tiers[{minQtyMilli, unitPriceMinor per base unit}] |
| COUPON | code typed at the POS, % or amount off the invoice | couponCode, valueBp / valueMinor, minTotalMinor, maxUses |

Scope: all products, categories, or specific products. Dates: business days (YYYYMMDD) in the business time zone, inclusive.

**Stacking (Q-06):** one automatic offer per line — the best for the customer (ties: priority, then id) → manual line
discount → coupon → manual invoice discount. Offers and coupons are not counted in the role caps. Lines with a manually
changed price get no automatic offer. Free "get" units go to the cheapest units first.

Posting re-applies offers inside the transaction (the UI's numbers are never trusted); a coupon that became invalid
(used up, expired) stops the sale with a clear message. Stored on the invoice and lines, part of the hash chain,
immutable (trigger `sales_docs_offers_immutable`). Coupon uses = posted invoices with that coupon. Plan feature `offers`.
