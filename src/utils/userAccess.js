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

export function resolveUserType({ userType, user_type, isAdmin, is_admin, isDev, is_dev } = {}) {
  const normalizedUserType = normalizeUserType(userType ?? user_type);
  const explicitAdminFlag = isAdmin ?? is_admin;
  const explicitDevFlag = isDev ?? is_dev;
  const hasExplicitAdmin = hasExplicitFlag(explicitAdminFlag);
  const hasExplicitDev = hasExplicitFlag(explicitDevFlag);
  const resolvedIsAdmin = hasExplicitAdmin
    ? normalizeBooleanFlag(explicitAdminFlag)
    : normalizedUserType === 'admin';
  const resolvedIsDev = hasExplicitDev
    ? normalizeBooleanFlag(explicitDevFlag)
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
      user_type: userOrType.user_type,
      isAdmin: userOrType.isAdmin,
      is_admin: userOrType.is_admin,
      isDev: userOrType.isDev,
      is_dev: userOrType.is_dev,
    });
  }

  return normalizeUserType(userOrType);
}

export function getDefaultRouteForUserType() {
  return '/home';
}

export function canAccessUserType(userOrType, allowedUserTypes = []) {
  if (!Array.isArray(allowedUserTypes) || allowedUserTypes.length === 0) {
    return true;
  }

  const normalized = resolveAccessUserType(userOrType);
  return allowedUserTypes.map((value) => normalizeUserType(value)).includes(normalized);
}
