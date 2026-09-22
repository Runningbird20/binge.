-- Provider-independent PostgreSQL schema. Never writes to Supabase schemas.
CREATE SCHEMA IF NOT EXISTS binge;
CREATE TABLE IF NOT EXISTS binge.accounts (
  id text PRIMARY KEY,
  email text NOT NULL,
  password_hash text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  last_sign_in_at timestamptz,
  disabled boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email ON binge.accounts(lower(email));
CREATE TABLE IF NOT EXISTS binge.sessions (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES binge.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_account ON binge.sessions(account_id);
CREATE TABLE IF NOT EXISTS binge.records (
  collection text NOT NULL,
  id text NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (collection,id),
  CHECK (data->>'id' = id)
);
CREATE INDEX IF NOT EXISTS records_owner ON binge.records(collection,(data->>'user_id'),(data->>'profile_id'));
CREATE INDEX IF NOT EXISTS records_account ON binge.records(collection,(data->>'account_id'));
CREATE INDEX IF NOT EXISTS records_title ON binge.records(collection,(data->>'title'),id);
CREATE INDEX IF NOT EXISTS records_year ON binge.records(collection,((data->>'year')::numeric),id) WHERE collection IN ('movies','tv_shows','books');
CREATE UNIQUE INDEX IF NOT EXISTS profiles_username ON binge.records(lower(data->>'username')) WHERE collection='profiles';
CREATE UNIQUE INDEX IF NOT EXISTS profiles_default ON binge.records((data->>'account_id')) WHERE collection='account_profiles' AND data->>'is_default'='true';
CREATE UNIQUE INDEX IF NOT EXISTS library_identity ON binge.records(collection,(data->>'user_id'),coalesce(data->>'profile_id',''),(data->>'media_type'),(data->>'media_id')) WHERE collection IN ('watchlist','continue_watching');
CREATE UNIQUE INDEX IF NOT EXISTS ratings_identity ON binge.records(collection,(data->>'user_id'),coalesce(data->>'profile_id',''),(data->>'media_id')) WHERE collection IN ('movie_ratings','tv_show_ratings','book_ratings');
CREATE UNIQUE INDEX IF NOT EXISTS episodes_identity ON binge.records((data->>'user_id'),coalesce(data->>'profile_id',''),(data->>'media_id'),(data->>'season'),(data->>'episode')) WHERE collection='episode_progress';
CREATE TABLE IF NOT EXISTS binge.assets (
  bucket text NOT NULL,
  name text NOT NULL,
  owner_id text REFERENCES binge.accounts(id) ON DELETE CASCADE,
  content_type text NOT NULL,
  content bytea NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(bucket,name)
);
CREATE TABLE IF NOT EXISTS binge.auth_limits (
  key text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS binge.password_resets (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES binge.accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
