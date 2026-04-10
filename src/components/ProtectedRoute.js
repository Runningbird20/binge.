import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

export default function ProtectedRoute({ children }) {
  const { isAuthenticated, authLoading } = useAuth();

  if (authLoading) {
    return <div className="loading-state">Loading your account...</div>;
  }

  return isAuthenticated ? children : <Navigate to="/login" replace />;
}
