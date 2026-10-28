// Preserve legacy identities and ownership links. Passwords must be reset:
// Supabase password hashes are incompatible with managed Neon Auth.
require('dotenv').config({ quiet: true });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('binge-legacy-auth-migration'))");
    const conflicts = await client.query(`
      SELECT count(*) AS count FROM auth.users legacy
      JOIN neon_auth."user" current ON lower(current.email) = lower(legacy.email)
      WHERE current.id <> legacy.id
    `);
    if (Number(conflicts.rows[0].count)) throw new Error('Email conflicts require manual identity reconciliation.');
    const users = await client.query(`
      INSERT INTO neon_auth."user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role, banned, "banExpires")
      SELECT u.id, coalesce(nullif(p.username, ''), nullif(u.raw_user_meta_data->>'username', ''), split_part(u.email, '@', 1)),
        lower(trim(u.email)), u.email_confirmed_at IS NOT NULL, p.avatar_url,
        coalesce(u.created_at, now()), now(),
        CASE WHEN p.is_admin THEN 'admin' WHEN p.is_dev THEN 'dev' ELSE 'user' END,
        coalesce(u.banned_until > now(), false), u.banned_until
      FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
      ON CONFLICT (id) DO NOTHING RETURNING id
    `);
    const accounts = await client.query(`
      INSERT INTO neon_auth.account ("accountId", "providerId", "userId", password, "createdAt", "updatedAt")
      SELECT u.id::text, 'credential', u.id, NULL, now(), now()
      FROM auth.users u
      WHERE NOT EXISTS (SELECT 1 FROM neon_auth.account a WHERE a."userId" = u.id AND a."providerId" = 'credential')
      RETURNING id
    `);
    const missing = await client.query('SELECT count(*) AS count FROM auth.users u LEFT JOIN neon_auth."user" n ON n.id = u.id WHERE n.id IS NULL');
    if (Number(missing.rows[0].count)) throw new Error('Some legacy identities are missing; rolling back.');
    await client.query('COMMIT');
    console.log(JSON.stringify({ migratedUsers: users.rowCount, createdPasswordAccounts: accounts.rowCount, missingUsers: 0, passwordResetRequired: true }));
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
