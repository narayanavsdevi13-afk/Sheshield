-- Adds the columns required by the SheShield API without deleting or rewriting
-- existing contact or alert rows. Existing BIGINT IDENTITY columns are unchanged.

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.alerts
  ADD COLUMN IF NOT EXISTS client_alert_id text,
  ADD COLUMN IF NOT EXISTS communication_mode text,
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS status_label text,
  ADD COLUMN IF NOT EXISTS accuracy_m double precision,
  ADD COLUMN IF NOT EXISTS location_source text,
  ADD COLUMN IF NOT EXISTS retry_mode text;

CREATE UNIQUE INDEX IF NOT EXISTS alerts_user_client_alert_id_unique
  ON public.alerts (user_id, client_alert_id)
  WHERE client_alert_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alerts_communication_mode_check'
      AND conrelid = 'public.alerts'::regclass
  ) THEN
    ALTER TABLE public.alerts
      ADD CONSTRAINT alerts_communication_mode_check
      CHECK (communication_mode IS NULL OR communication_mode IN ('cellular', 'satellite', 'offline'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alerts_status_check'
      AND conrelid = 'public.alerts'::regclass
  ) THEN
    ALTER TABLE public.alerts
      ADD CONSTRAINT alerts_status_check
      CHECK (status IS NULL OR status IN ('queued', 'delivered', 'cancelled'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alerts_location_source_check'
      AND conrelid = 'public.alerts'::regclass
  ) THEN
    ALTER TABLE public.alerts
      ADD CONSTRAINT alerts_location_source_check
      CHECK (location_source IS NULL OR location_source IN ('browser', 'demo'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'alerts_retry_mode_check'
      AND conrelid = 'public.alerts'::regclass
  ) THEN
    ALTER TABLE public.alerts
      ADD CONSTRAINT alerts_retry_mode_check
      CHECK (retry_mode IS NULL OR retry_mode IN ('cellular', 'satellite'));
  END IF;
END
$$;

-- Remove every existing policy on these two tables before recreating the
-- owner-scoped policies below. This prevents a permissive legacy policy from
-- granting access to another user's rows. The migration does not drop either
-- table or modify its data.
DO $$
DECLARE
  target_table text;
  existing_policy record;
BEGIN
  FOREACH target_table IN ARRAY ARRAY['contacts', 'alerts']
  LOOP
    FOR existing_policy IN
      SELECT policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = target_table
    LOOP
      EXECUTE format(
        'DROP POLICY %I ON public.%I',
        existing_policy.policyname,
        target_table
      );
    END LOOP;
  END LOOP;
END
$$;

CREATE POLICY sheshield_contacts_select_own ON public.contacts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY sheshield_contacts_insert_own ON public.contacts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sheshield_contacts_delete_own ON public.contacts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY sheshield_alerts_select_own ON public.alerts
  FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY sheshield_alerts_insert_own ON public.alerts
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sheshield_alerts_update_own ON public.alerts
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sheshield_alerts_delete_own ON public.alerts
  FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

NOTIFY pgrst, 'reload schema';

-- Confirm the resulting policies. Every application-user policy is limited to
-- authenticated users and matches auth.uid() against the row's user_id.
SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('contacts', 'alerts')
ORDER BY tablename, policyname;
