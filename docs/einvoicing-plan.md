# Tax e-invoicing integration plans (documents only — owner decision: deferred)

## Saudi Arabia — ZATCA Phase 2 (integration)
Already in place: Phase 1 TLV QR on simplified invoices; per-device hash chain (same idea as ZATCA PIH); immutable
invoices; credit notes = returns linked to the invoice; VAT per line; device codes.
To add:
1. **Onboarding per device (EGS unit):** generate secp256k1 key + CSR with the business VAT/CR data → compliance CSID
   (OTP from Fatoora portal) → compliance checks (sample invoices) → production CSID. Keys in SecureStore.
2. **UBL 2.1 XML** generator from posted docs (simplified 0200000 / standard 0100000, credit/debit notes), canonical
   C14N, invoice hash (SHA-256), ECDSA signature with the CSID, XAdES properties, ICV (counter) + PIH (previous hash)
   — map PIH to our chain (separate ZATCA chain field to keep ours unchanged).
3. **QR Phase 2:** tags 1–9 (incl. hash, signature, public key, CSID stamp).
4. **Reporting/clearance:** simplified invoices reported within 24 h (queue on the phone, sent in batches with the
   check-in through a Worker relay or directly to ZATCA); standard B2B invoices need clearance before sharing.
5. Offline: invoices keep being issued; reporting queue retries; status shown on the invoice.
Effort: ~4–6 weeks + ZATCA sandbox certification.

## Egypt — ETA e-receipt (B2C) / e-invoice (B2B)
1. Register the taxpayer and each POS device on the ETA portal (POS serial, OS version, model, activity code).
2. Receipt JSON (header, seller, buyer, items with GS1/EGS codes, taxes) → **UUID = SHA-256 of the canonical
   serialization** with the previous receipt UUID (similar to our chain).
3. Submit via the ETA e-receipt API with client credentials (per device), in batches; offline queue with retries;
   printed receipt carries the ETA QR (URL with UUID).
4. Item coding: map products to EGS/GS1 codes (new product field + bulk import column).
5. B2B e-invoice (signed with a USB token/HSM) is out of scope for phones — export to an accountant tool or a
   Worker-side signing service.
Effort: ~3–4 weeks + ETA preprod testing.
