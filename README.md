# binge.

A social media-tracking web app for movies, TV shows, and books. Users build a personal profile, track what they watch and read, rate titles, collaborate on ranked lists, and discuss everything in a community forum — all with a clean dark UI.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, React Router 7, custom CSS |
| Backend | Express 5 (deployed as Vercel serverless functions) |
| Database / Auth | Supabase (Postgres + Row Level Security + Auth) |
| AI | Groq (`llama-3.3-70b-versatile`) — chatbot + content moderation |
| Deployment | Vercel (frontend + API serverless functions in one project) |
| Media Data | TMDB, Plex, Internet Archive, Open Library |

---

## Features

**Content Browsing**
- Movies, TV shows, and books with search, filtering, and detail modals
- Live TV channel browser with embedded player
- Global search across all media (Cmd+K or S)

**Personal Tracking**
- Watchlist with status per item (Plan to Watch / Watching / Watched, and reading equivalents)
- Progress tracking — season/episode for TV, chapter/page for books
- Star and numeric ratings for all media types
- Personal ratings page with sort and filter

**Social**
- Public user profiles with avatar, bio, stats card, and activity
- Follow / unfollow users
- Following feed aggregating activity from people you follow
- Trending page — most discussed and highest rated content
- Notification bell for follows and social activity

**Collaborative Lists**
- Create named lists (public or private) and invite collaborators by username
- Vibe voting (upvote / downvote) surfaces the group's consensus pick
- Manual item reordering
- Shareable public URL per list

**Forum**
- Create communities with custom icon, banner color, and rules
- Posts with flair (Discussion, Review, Spoiler, Leak, Meme, etc.), hashtags, and Markdown body
- Flair filtering — click any flair in the sidebar to filter posts
- Inline spoiler tags in post/comment bodies — write `[spoiler]text[/spoiler]`, reader clicks to reveal
- Full-post spoiler flair hides body behind a click-to-reveal overlay
- Nested comment threads with voting, editing, replying, and collapsing
- AI content moderation — offensive or inappropriate posts are blocked before publishing
- Sort by Hot / New / Top, search within a community
- Report system for posts and comments
- Pinned post support

**Watch Together**
- Synchronized Watch Rooms where multiple users watch the same content simultaneously
- In-room chat alongside the player

**AI**
- Chatbot assistant for recommendations and media questions (Groq)
- Auto-moderation of forum posts and comments

**Account & Settings**
- Email / password authentication via Supabase Auth
- Username, email, and password management
- Avatar and bio editing from profile

**Admin Panel** *(admin role only)*
- User management — view, search, promote, demote, ban
- Media request queue — approve or reject user submissions
- Analytics dashboard — usage stats, chat logs, error tracking

**Developer Lab** *(admin + dev roles)*
- Prompt tuning, AI intent testing, and system diagnostics

**PWA**
- Installable as a home screen app on mobile (standalone display mode)
- Proper Open Graph and Apple touch icon metadata

---

## Local Development

### Requirements

- Node.js `24.x`
- npm

### Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill in the values (see Environment Variables below).

### Start

```bash
npm start          # React frontend (port 3000) + Express server (port 5001) together
npm run start:client   # React only
npm run server         # Express only
```

---

## Environment Variables

### Frontend (prefix `REACT_APP_` — bundled into the build)

| Variable | Description |
|---|---|
| `REACT_APP_SUPABASE_URL` | Your Supabase project URL |
| `REACT_APP_SUPABASE_PUBLISHABLE_KEY` | Supabase publishable / anon key |
| `REACT_APP_ENABLE_LEGACY_BACKEND` | Set `true` to enable Express API calls |
| `REACT_APP_LEGACY_API_URL` | Express server URL (leave blank to use same-origin `/api`) |
| `REACT_APP_TMDB_API_KEY` | TMDB API key for movie/TV metadata |
| `REACT_APP_ENV` | `development` or `production` |

### Server (Express — never bundled into the frontend build)

| Variable | Description |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key — **keep secret** |
| `SUPABASE_DB_URL` | Postgres connection string |
| `GROQ_API_KEY` | Groq API key for AI chatbot and moderation |
| `TAVILY_API_KEY` | Tavily API key for web search in chatbot |
| `TMDB_API_KEY` | TMDB API key (server-side use) |
| `CLIENT_URL` | Allowed CORS origin (your frontend URL in production) |

---

## Deployment (Vercel)

The project deploys as a single Vercel project. The React frontend is a static build and the Express server runs as a Vercel serverless function via `api/[...slug].js`.

### vercel.json

`vercel.json` is already configured. `/api/*` requests are routed to the serverless Express function; everything else falls through to `index.html` for client-side routing.

### Required environment variables in Vercel dashboard

Add these under **Project → Settings → Environment Variables**:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
GROQ_API_KEY
TAVILY_API_KEY
TMDB_API_KEY
NODE_ENV=production
CLIENT_URL=https://your-app.vercel.app
```

These are server secrets — set them in the Vercel dashboard, not in `vercel.json` (which is committed to the repo).

The `REACT_APP_*` variables are already in `vercel.json` and will be picked up automatically at build time.

### Deploy

Push to your connected GitHub branch. Vercel builds and deploys automatically. The first deploy after setup may take a minute to warm up the serverless functions.

---

## Database Migrations

Migrations live in `supabase/migrations/`. Apply them in the Supabase SQL Editor or via the Supabase CLI:

```bash
npx supabase db push
```

Key migrations:
- `20260413043101_remote_schema.sql` — base schema
- `20260413070000_forum.sql` — forum tables
- `20260416193000_client_supabase_access.sql` — RLS access policies
- `20260427120000_media_lists_rls.sql` — initial lists RLS
- `20260427130000_media_lists_rls_v2.sql` — fixed lists RLS (resolves infinite recursion via SECURITY DEFINER helpers)

---

## Media Data Import Scripts

All import scripts write normalized JSON/JSONL that gets seeded into Supabase.

### TMDB (recommended)

```bash
npm run import:tmdb           # movies + TV, 20 pages
npm run import:tmdb:movies    # movies only
npm run import:tmdb:tv        # TV only
npm run import:tmdb:large     # 100 pages
npm run import:tmdb:resume    # resume a previous run
```

### Plex

```bash
npm run import:movies         # 25 movies
npm run import:movies:bulk    # up to 100 movies
npm run import:movies:resume  # resume bulk run
npm run import:tv             # 25 TV shows
npm run import:tv:bulk        # up to 100 shows
npm run import:tv:resume      # resume bulk run
```

### Books (Internet Archive / Open Library)

```bash
npm run import:books           # 25 books from Internet Archive
npm run import:books:bulk      # bulk Internet Archive run
npm run import:books:resume    # resume bulk run
npm run import:openlibrary     # 5 pages from Open Library
npm run import:openlibrary:large    # 20 pages
npm run import:openlibrary:resume   # resume Open Library run
```

### Seeding Supabase

```bash
npm run supabase:seed:catalogs   # runs schema + all seed files against Supabase
```

---

## Project Structure

```
├── api/                    # Vercel serverless function (wraps Express)
│   ├── index.js
│   └── [...slug].js
├── server/                 # Express app
│   ├── app.js
│   ├── index.js
│   └── routes/             # auth, chat, forum, lists, media, ratings, ...
├── src/
│   ├── components/         # Navbar, GlobalSearch, ChatBot, NotificationBell, ...
│   ├── contexts/           # AuthContext
│   ├── pages/              # All page components
│   └── utils/              # supabaseApi.js, supabaseData.js, api.js
├── supabase/
│   ├── migrations/         # SQL migration files
│   └── repeatable_schema.sql
├── public/
│   ├── manifest.json       # PWA manifest
│   └── index.html
└── vercel.json
```
