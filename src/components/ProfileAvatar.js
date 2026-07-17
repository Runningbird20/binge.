import { UserCircle } from '@phosphor-icons/react';

// Sub-profiles don't have real image upload — avatar_url instead holds either
// a real image URL (http...) or one of the emoji from AVATAR_EMOJI below,
// picked at profile-creation time. Renders whichever it finds, falling back
// to a color-coded silhouette keyed off the profile id so unset avatars
// still look distinct from one another at a glance.
export const AVATAR_COLORS = ['#e5484d', '#f76b15', '#f5b400', '#30a46c', '#3b82f6', '#8b5cf6', '#ec4899'];
export const AVATAR_EMOJI = ['🦊', '🐼', '🐯', '🐸', '🦄', '🐙', '🦁', '🐨', '🤖', '👽', '🧑‍🚀', '🦸'];

export function colorForId(id) {
  let hash = 0;
  const str = String(id || '');
  for (let i = 0; i < str.length; i += 1) hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

export default function ProfileAvatar({ profile, size = 32 }) {
  const avatar = profile?.avatar_url;
  const isImage = typeof avatar === 'string' && /^(https?:|data:)/.test(avatar);
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.55),
    background: isImage ? undefined : profile?.avatar_color || colorForId(profile?.id || profile?.name),
  };

  return (
    <span className="profile-avatar" style={style}>
      {isImage ? (
        <img src={avatar} alt="" referrerPolicy="no-referrer" />
      ) : avatar ? (
        <span aria-hidden="true">{avatar}</span>
      ) : (
        <UserCircle size={Math.round(size * 0.75)} weight="fill" aria-hidden="true" />
      )}
    </span>
  );
}
