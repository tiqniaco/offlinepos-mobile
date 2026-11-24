-- Server backups stay small (data only, no product photos): fewer copies kept and a smaller storage cap.
-- Only plan rows still holding the original seed values change; values a super-admin edited are kept.
UPDATE plans SET limits_json = json_set(limits_json, '$.backups_kept', 5)
  WHERE code = 'basic' AND json_extract(limits_json, '$.backups_kept') = 7;
UPDATE plans SET limits_json = json_set(limits_json, '$.backup_storage_mb', 50)
  WHERE code = 'basic' AND json_extract(limits_json, '$.backup_storage_mb') = 150;
UPDATE plans SET limits_json = json_set(limits_json, '$.backups_kept', 7)
  WHERE code = 'pro' AND json_extract(limits_json, '$.backups_kept') = 30;
UPDATE plans SET limits_json = json_set(limits_json, '$.backup_storage_mb', 100)
  WHERE code = 'pro' AND json_extract(limits_json, '$.backup_storage_mb') = 1024;
