function getInitials(name = '') {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return '?';
  }

  return parts.map((part) => part[0].toUpperCase()).join('');
}

export default function UserAvatar({
  avatarUrl,
  name,
  size = 'md',
  alt = `${name || 'User'} avatar`,
}) {
  const classes = ['user-avatar', `user-avatar-${size}`].join(' ');

  if (avatarUrl) {
    return (
      <div className={classes}>
        <img className="user-avatar-image" src={avatarUrl} alt={alt} />
      </div>
    );
  }

  return (
    <div className={classes} aria-label={`${name || 'User'} avatar placeholder`}>
      <span className="user-avatar-fallback">{getInitials(name)}</span>
    </div>
  );
}
