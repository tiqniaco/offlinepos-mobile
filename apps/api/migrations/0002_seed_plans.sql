-- Seed plans (PLAN.md §17.1). Editable later in super admin.
INSERT INTO plans (code, name_ar, name_en, monthly_egp, monthly_sar, yearly_egp, yearly_sar, limits_json, features_json, is_free, trial_days, active, updated_at) VALUES
('free',  'مجاني',  'Free',  0, 0, 0, 0,
  '{"users":1,"products":100,"parties":50,"invoices_month":150,"backups_kept":3}', '[]', 1, 0, 1, 0),
('basic', 'أساسي',  'Basic', 14900, 3900, 149000, 39000,
  '{"users":3,"products":3000,"parties":-1,"invoices_month":3000,"backups_kept":7}',
  '["no_ads","multi_unit","offers","expenses_shifts"]', 0, 0, 1, 0),
('pro',   'احترافي', 'Pro',  29900, 7900, 299000, 79000,
  '{"users":10,"products":-1,"parties":-1,"invoices_month":-1,"backups_kept":30}',
  '["no_ads","multi_unit","offers","expenses_shifts","expiry","adv_reports","custom_roles"]', 0, 14, 1, 0);
