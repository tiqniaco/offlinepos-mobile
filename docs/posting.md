# Sales posting, hash chain and journal (Phase 3)

Code: `apps/mobile/src/domain/sales/sales.ts`, `domain/integrity/chain.ts`, `domain/accounting/journal.ts`,
`domain/parties/customers.ts`, shared pricing in `packages/shared/src/pricing.ts`.

## One transaction per sale (`postSale`)
1. Permission `sales.create`, licence `assertCanWrite`, monthly invoice limit (plan).
2. Re-price the cart with the shared engine (`priceDraft`) — the UI's numbers are never trusted.
3. Approvals: a price different from the catalog needs `price.change`; discounts above the role caps
   (`maxItemDiscountBp`, `maxInvoiceDiscountBp`) need a manager. The manager types their PIN on the
   cashier's phone (`ApproveSheet`); the service re-checks the approver's own caps and writes an audit entry.
4. `settle()` validates payments: split allowed; only cash may exceed (→ change); credit (آجل) needs a customer.
5. Clock guard: the posting time may not be earlier than the last chain entry (`clock_behind`).
6. Number `INV-A-000123` from `doc_sequences`.
7. Stock: one `SALE` movement per line (base units), valued at the moving average → cost snapshot on the line.
8. Rows: document (DRAFT), lines, payments; customer ledger debit for credit.
9. Journal: Dr payment accounts (Cash/Card/Wallet/Bank/AR) · Cr Sales (net) · Cr VAT output · ± Rounding ·
   Dr COGS / Cr Inventory. Must balance (`UnbalancedJournalError`).
10. Hash chain entry built from the STORED rows, then status → POSTED, audit `sale.post`.
11. Commit. Printing starts only now (`printReceiptInBackground`) and can never undo the sale.

## Immutability (SQLite triggers, `0005_sales_triggers.sql`)
Posted/voided invoices & returns: no column may change except `print_count`, `last_printed_at`, and the single
POSTED → VOIDED transition with its void fields. Lines and payments of posted documents cannot change
(payments: only the `voided` flag). `party_ledger`, `journal_*`, `integrity_chain` are append-only.

## Corrections
- **Return** (`postReturn`): linked to the invoice, per line up to what is left; proportional refund and the last
  return of a line takes the exact remainder; stock comes back at the ORIGINAL cost; refund by cash/card/wallet/bank
  or as customer credit; journal Dr Sales returns + VAT / Cr refund account; Dr Inventory / Cr COGS.
- **Void** (`voidSale`): `doc.void` permission (Manager/Owner), same business day, no returns, reason required.
  Mirrors stock (`VOID_REVERSAL` at the original cost), customer ledger and the journal entry; a `VOID` chain entry
  records who/when/why. The original rows and hash stay untouched; only `status` flips.
  (Becomes "while the shift is open" when cash shifts arrive in Phase 4.)
- **Held sales** (`PARKED`) and **quotations** (`QUOTATION`, numbered `QUO-A-…`) are drafts: editable, no stock,
  no chain. A quotation is marked `CONVERTED` when sold.

## Hash chain (`integrity_chain`, PLAN.md §7.3)
`hash = SHA-256(canonical_json(payload) || prev_hash)`, one chain per device, genesis = 64 zeros.
Entries: `SALES_INVOICE`, `SALES_RETURN`, `VOID`, `INVENTORY` (opening, adjustments, counts — chained since Phase 3).
`salesPayload()` / `inventoryPayload()` list exactly the immutable fields (never status/print/void fields).
`verifyChain()` rebuilds each payload from the database and reports the first break: `hash_mismatch` (edited
document/line/payment), `link`, `gap` (deleted entry), `missing_doc`, `doc_hash`.
More → فحص سلامة السجلات runs it together with the audit-log chain. Server anchors are added in Phase 6.

## Chart of accounts (system)
CASH, CARD, WALLET, BANK, AR, INVENTORY, VAT_IN, AP, VAT_OUT, OPENING_EQUITY, SALES, SALES_RETURNS, ROUNDING,
COGS, STOCK_ADJ, EXPENSES — seeded by `ensureAccounts`. Opening stock: Dr Inventory / Cr Opening balances;
adjustments & counts: Inventory vs Stock adjustments.

## Tests (`sales.db.test.ts`)
Posting, carton barcode, split + credit, rollback on errors, negative-stock block, manager override, monthly limit,
clock guard, park/quotation, returns, void, triggers, **tamper detection with triggers removed (rooted phone)**,
deleted-entry gap, and a property test: random sales/returns/voids/adjustments keep the journal balanced, stock
cache == ledger, chain intact, customer balance == its ledger == AR.
