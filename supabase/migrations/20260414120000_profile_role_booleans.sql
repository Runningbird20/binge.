ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_dev boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'user_type'
  ) THEN
    EXECUTE $sql$
      UPDATE public.profiles
      SET
        is_admin = coalesce(is_admin, false) OR lower(coalesce(user_type, '')) IN ('admin', 'admins'),
        is_dev = coalesce(is_dev, false) OR lower(coalesce(user_type, '')) IN ('coach', 'coaches', 'developer', 'developers', 'dev')
    $sql$;
  END IF;
END;
$$;

UPDATE public.profiles
SET
  is_admin = coalesce(is_admin, false),
  is_dev = coalesce(is_dev, false)
WHERE is_admin IS NULL
   OR is_dev IS NULL;
