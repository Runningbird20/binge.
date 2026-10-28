# Profile editing and locks

Apply `supabase/migrations/20261028120000_profile_locks.sql` in the Supabase SQL
editor before using the updated profile picker. Alternatively configure
SUPABASE_DB_URL and run:

```
npm run supabase:sql -- supabase/migrations/20261028120000_profile_locks.sql
```

The picker offers Edit profile for age restrictions (the existing kids-safe
allowlist or all ratings) and an optional four-digit PIN. Saving asks for the
account password. Blank PIN keeps the existing lock; Remove profile lock deletes
it. PINs are bcrypt hashed in an RLS-protected table. Verification is an
account-scoped RPC with a five-minute cooldown after five incorrect attempts.

This is a profile-selection lock inside a shared authenticated account, not an
independent authorization boundary. Existing database policies remain scoped to
the account, and direct navigation/API access is not protected by the PIN.
Accounts using only Neon Auth do not support these Supabase RPCs.

Validation: component tests cover failed/successful PIN verification and failed
account reauthentication; the production build passes. Live migration execution
and email/password-based end-to-end verification require Supabase configuration.
