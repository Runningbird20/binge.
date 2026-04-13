-- Add is_admin flag to profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS is_admin boolean NOT NULL DEFAULT false;

-- To make yourself admin, run:
-- UPDATE public.profiles SET is_admin = true WHERE username = 'your_username';

-- Add rules column to forums
ALTER TABLE public.forums ADD COLUMN IF NOT EXISTS rules text;
