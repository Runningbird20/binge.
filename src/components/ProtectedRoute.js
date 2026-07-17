import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessUserType, getDefaultRouteForUserType } from '../utils/userAccess';

export default function ProtectedRoute({ children, allowedUserTypes }) {
  const { isAuthenticated, authLoading, user, canUseAdminFeatures, canUseDevFeatures } = useAuth();

  // While auth is loading, render nothing (invisible) rather than
  // a loading spinner that causes a visible flash on every navigation
  if (authLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Admin/dev routes: the account may hold that role, but a non-default
  // (sub-)profile never gets to use it — see canUseAdminFeatures.
  const effectiveUser = {
    ...user,
    isAdmin: canUseAdminFeatures,
    isDev: canUseDevFeatures,
    userType: canUseAdminFeatures ? 'admin' : canUseDevFeatures ? 'dev' : 'user',
  };

  if (!canAccessUserType(effectiveUser, allowedUserTypes)) {
    return <Navigate to={getDefaultRouteForUserType(user)} replace />;
  }

  return children;
}
