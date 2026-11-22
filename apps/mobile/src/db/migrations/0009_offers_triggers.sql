-- Phase 5: offer/coupon columns of posted sales are immutable like the rest of the document.
CREATE TRIGGER sales_docs_offers_immutable BEFORE UPDATE ON sales_docs
WHEN OLD.status IN ('POSTED', 'VOIDED') AND OLD.type IN ('INVOICE', 'RETURN') AND (
  NEW.offer_discount_minor IS NOT OLD.offer_discount_minor OR NEW.coupon_code IS NOT OLD.coupon_code
  OR NEW.coupon_offer_id IS NOT OLD.coupon_offer_id OR NEW.coupon_discount_minor IS NOT OLD.coupon_discount_minor
  OR NEW.shift_id IS NOT OLD.shift_id
)
BEGIN
  SELECT RAISE(ABORT, 'posted document is immutable');
END;
--> statement-breakpoint
CREATE INDEX sales_docs_coupon ON sales_docs (coupon_offer_id) WHERE coupon_offer_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX sales_docs_cashier_day ON sales_docs (cashier_id, business_day);
