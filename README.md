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
