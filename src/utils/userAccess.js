function hasExplicitFlag(value) {
  return value !== undefined && value !== null && value !== '';
}

export function normalizeBooleanFlag(value) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    return value !== 0;
  }

  const normalized = String(value ?? '').trim().toLowerCase();
  return ['true', '1', 'yes', 'y', 'on'].includes(normalized);
}

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
    return 'dev';
  }

  return 'user';
}

export function resolveUserType({ userType, isAdmin, isDev } = {}) {
  const normalizedUserType = normalizeUserType(userType);
  const hasExplicitAdmin = hasExplicitFlag(isAdmin);
  const hasExplicitDev = hasExplicitFlag(isDev);
  const resolvedIsAdmin = hasExplicitAdmin
    ? normalizeBooleanFlag(isAdmin)
    : normalizedUserType === 'admin';
  const resolvedIsDev = hasExplicitDev
    ? normalizeBooleanFlag(isDev)
    : normalizedUserType === 'dev';

  if (resolvedIsAdmin) {
    return 'admin';
  }

  if (resolvedIsDev) {
    return 'dev';
  }

  if (!hasExplicitAdmin && !hasExplicitDev) {
    return normalizedUserType;
  }

  return 'user';
}

export function getDefaultRouteForUserType(userType) {
  const normalized = normalizeUserType(userType);

  if (normalized === 'admin') {
    return '/admin';
  }

  if (normalized === 'dev') {
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
