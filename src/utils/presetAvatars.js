// A small set of built-in avatar choices so new users aren't stuck with
// just an uploaded photo or their initials. Rendered as inline SVGs (no
// network request, no storage upload needed) — selecting one just sets
// avatarUrl to its data URI directly.
function buildPresetAvatar(id, from, to, emoji) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${from}"/>
        <stop offset="100%" stop-color="${to}"/>
      </linearGradient>
    </defs>
    <rect width="160" height="160" fill="url(#g)"/>
    <text x="50%" y="54%" font-size="78" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  </svg>`;

  return { id, url: `data:image/svg+xml,${encodeURIComponent(svg)}` };
}

export const PRESET_AVATARS = [
  buildPresetAvatar('reel', '#4f46e5', '#7c3aed', '🎬'),
  buildPresetAvatar('tv', '#0891b2', '#0ea5e9', '📺'),
  buildPresetAvatar('books', '#b45309', '#d97706', '📚'),
  buildPresetAvatar('popcorn', '#dc2626', '#ec4899', '🍿'),
  buildPresetAvatar('masks', '#a21caf', '#db2777', '🎭'),
  buildPresetAvatar('star', '#ca8a04', '#f59e0b', '⭐'),
  buildPresetAvatar('moon', '#312e81', '#4338ca', '🌙'),
  buildPresetAvatar('owl', '#15803d', '#0d9488', '🦉'),
  buildPresetAvatar('fire', '#c2410c', '#dc2626', '🔥'),
  buildPresetAvatar('alien', '#16a34a', '#65a30d', '👾'),
];
