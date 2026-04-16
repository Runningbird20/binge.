import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canAccessUserType, getDefaultRouteForUserType } from '../utils/userAccess';

export default function ProtectedRoute({ children, allowedUserTypes = [] }) {
  const { isAuthenticated, authLoading, user } = useAuth();

  if (authLoading) {
    return <div className="loading-state">Loading your account...</div>;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (!canAccessUserType(user, allowedUserTypes)) {
    return <Navigate to={getDefaultRouteForUserType(user)} replace />;
  }

  return children;
}
