ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS user_type text NOT NULL DEFAULT 'user';

UPDATE public.profiles
SET user_type = 'user'
WHERE user_type IS NULL OR btrim(user_type) = '';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_admin'
  ) THEN
    EXECUTE $sql$
      UPDATE public.profiles
      SET user_type = 'admin'
      WHERE is_admin = true
    $sql$;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.profiles'::regclass
      AND conname = 'profiles_user_type_check'
  ) THEN
    ALTER TABLE public.profiles
      ADD CONSTRAINT profiles_user_type_check
      CHECK (user_type IN ('user', 'coach', 'admin'));
  END IF;
END;
$$;

-- To make yourself admin, run:
-- UPDATE public.profiles SET user_type = 'admin' WHERE username = 'your_username';

-- Add rules column to forums
ALTER TABLE public.forums ADD COLUMN IF NOT EXISTS rules text;
