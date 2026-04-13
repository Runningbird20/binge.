import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import { hasLegacyBackendSession, isLegacyBackendEnabled } from './utils/legacyBackend';
import './App.css';

const ChatBot = lazy(() => import('./components/ChatBot'));
const Home = lazy(() => import('./pages/Home'));
const Movies = lazy(() => import('./pages/Movies'));
const TVShows = lazy(() => import('./pages/TVShows'));
const Books = lazy(() => import('./pages/Books'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Lists = lazy(() => import('./pages/Lists'));
const SharedList = lazy(() => import('./pages/SharedList'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const AdminRequests = lazy(() => import('./pages/AdminRequests'));
const LiveTV = lazy(() => import('./pages/LiveTV'));
const Ratings = lazy(() => import('./pages/Ratings'));
const LegacyBackendNotice = lazy(() => import('./components/LegacyBackendNotice'));

function AppRouteFallback() {
  return <div className="loading-state">Loading the app...</div>;
}

export default function App() {
  const legacyBackendEnabled = isLegacyBackendEnabled();

  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<AppRouteFallback />}>
          <Routes>
            <Route path="/"          element={<Landing />} />
            <Route path="/login"     element={<Login />} />
            <Route path="/signup"    element={<Signup />} />
            <Route path="/home"      element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/movies"    element={<ProtectedRoute><Movies /></ProtectedRoute>} />
            <Route path="/tv-shows"  element={<ProtectedRoute><TVShows /></ProtectedRoute>} />
            <Route path="/books"     element={<ProtectedRoute><Books /></ProtectedRoute>} />
            <Route path="/ratings"   element={<ProtectedRoute><Ratings /></ProtectedRoute>} />
            <Route path="/watchlist" element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
            <Route
              path="/lists"
              element={legacyBackendEnabled
                ? <ProtectedRoute><Lists /></ProtectedRoute>
                : <ProtectedRoute><LegacyBackendNotice featureName="Shared Lists" isProtected /></ProtectedRoute>}
            />
            <Route
              path="/lists/:shareCode"
              element={legacyBackendEnabled
                ? <SharedList />
                : <LegacyBackendNotice featureName="Shared Lists" />}
            />
            <Route path="/account-settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
            <Route
              path="/admin/requests"
              element={legacyBackendEnabled
                ? <ProtectedRoute><AdminRequests /></ProtectedRoute>
                : <ProtectedRoute><LegacyBackendNotice featureName="Admin Requests" isProtected /></ProtectedRoute>}
            />
            <Route
              path="/live-tv"
              element={legacyBackendEnabled
                ? <ProtectedRoute><LiveTV /></ProtectedRoute>
                : <ProtectedRoute><LegacyBackendNotice featureName="Live TV" isProtected /></ProtectedRoute>}
            />
            <Route path="*"          element={<Navigate to="/" replace />} />
          </Routes>
          {hasLegacyBackendSession() && <ChatBot />}
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
