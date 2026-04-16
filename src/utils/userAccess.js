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

function resolveAccessUserType(userOrType) {
  if (userOrType && typeof userOrType === 'object') {
    return resolveUserType({
      userType: userOrType.userType,
      isAdmin: userOrType.isAdmin,
      isDev: userOrType.isDev,
    });
  }

  return normalizeUserType(userOrType);
}

export function getDefaultRouteForUserType(userOrType) {
  const normalized = resolveAccessUserType(userOrType);

  if (normalized === 'admin') {
    return '/admin';
  }

  if (normalized === 'dev') {
    return '/__ops/dev-lab';
  }

  return '/home';
}

export function canAccessUserType(userOrType, allowedUserTypes = []) {
  if (!Array.isArray(allowedUserTypes) || allowedUserTypes.length === 0) {
    return true;
  }

  const normalized = resolveAccessUserType(userOrType);
  return allowedUserTypes.map((value) => normalizeUserType(value)).includes(normalized);
}
