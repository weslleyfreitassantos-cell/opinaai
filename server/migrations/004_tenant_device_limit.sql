ALTER TABLE tenants ADD COLUMN IF NOT EXISTS device_limit INTEGER;

UPDATE tenants t
   SET device_limit = GREATEST(
     1,
     (SELECT COUNT(*)::int FROM devices d WHERE d.tenant_id = t.id AND d.active = true)
   )
 WHERE device_limit IS NULL;

ALTER TABLE tenants ALTER COLUMN device_limit SET DEFAULT 1;
ALTER TABLE tenants ALTER COLUMN device_limit SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'tenants_device_limit_check'
       AND conrelid = 'tenants'::regclass
  ) THEN
    ALTER TABLE tenants
      ADD CONSTRAINT tenants_device_limit_check CHECK (device_limit >= 1);
  END IF;
END $$;
