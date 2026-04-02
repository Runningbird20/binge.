const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, 'app.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function hasColumn(tableName, columnName) {
  return db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    bio TEXT NOT NULL DEFAULT '',
    avatar_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS movies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    year INTEGER,
    genre TEXT,
    director TEXT,
    synopsis TEXT,
    poster_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tv_shows (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    year INTEGER,
    genre TEXT,
    creator TEXT,
    synopsis TEXT,
    poster_url TEXT,
    seasons INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS books (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    author TEXT,
    year INTEGER,
    genre TEXT,
    synopsis TEXT,
    cover_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS ratings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv_show', 'book')),
    media_id INTEGER NOT NULL,
    rating INTEGER NOT NULL CHECK(rating >= 1 AND rating <= 5),
    review TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, media_type, media_id)
  );

  CREATE TABLE IF NOT EXISTS watchlist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    media_type TEXT NOT NULL CHECK(media_type IN ('movie', 'tv_show', 'book')),
    media_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'plan_to_watch',
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE (user_id, media_type, media_id)
  );
`);

if (!hasColumn('users', 'bio')) {
  db.exec("ALTER TABLE users ADD COLUMN bio TEXT NOT NULL DEFAULT ''");
}

if (!hasColumn('users', 'avatar_url')) {
  db.exec('ALTER TABLE users ADD COLUMN avatar_url TEXT');
}

module.exports = db;
