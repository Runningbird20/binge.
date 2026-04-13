export function normalizeUserType(value) {
  const normalized = String(value || '').trim().toLowerCase();

  if (normalized === 'admin' || normalized === 'admins') {
    return 'admin';
  }

  if (
    normalized === 'coach' ||
    normalized === 'coaches' ||
    normalized === 'developer' ||
    normalized === 'developers' ||
    normalized === 'dev'
  ) {
    return 'coach';
  }

  return 'user';
}

export function getDefaultRouteForUserType(userType) {
  const normalized = normalizeUserType(userType);

  if (normalized === 'admin') {
    return '/admin';
  }

  if (normalized === 'coach') {
    return '/__ops/dev-lab';
  }

  return '/home';
}

export function canAccessUserType(userType, allowedUserTypes = []) {
  if (!Array.isArray(allowedUserTypes) || allowedUserTypes.length === 0) {
    return true;
  }

  const normalized = normalizeUserType(userType);
  return allowedUserTypes.map((value) => normalizeUserType(value)).includes(normalized);
}
