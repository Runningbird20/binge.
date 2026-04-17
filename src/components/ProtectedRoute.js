import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessUserType, getDefaultRouteForUserType } from '../utils/userAccess';

export default function ProtectedRoute({ children, allowedUserTypes }) {
  const { isAuthenticated, authLoading, user } = useAuth();

  // While auth is loading, render nothing (invisible) rather than
  // a loading spinner that causes a visible flash on every navigation
  if (authLoading) return null;

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessUserType(user, allowedUserTypes)) {
    return <Navigate to={getDefaultRouteForUserType(user)} replace />;
  }

  return children;
}
