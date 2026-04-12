import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import ChatBot from './components/ChatBot';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Home from './pages/Home';
import Movies from './pages/Movies';
import TVShows from './pages/TVShows';
import Books from './pages/Books';
import Watchlist from './pages/Watchlist';
import Lists from './pages/Lists';
import SharedList from './pages/SharedList';
import AccountSettings from './pages/AccountSettings';
import AdminRequests from './pages/AdminRequests';
import LiveTV from './pages/LiveTV';
import Ratings from './pages/Ratings';
import LegacyBackendNotice from './components/LegacyBackendNotice';
import { hasLegacyBackendSession, isLegacyBackendEnabled } from './utils/legacyBackend';
import './App.css';

export default function App() {
  const legacyBackendEnabled = isLegacyBackendEnabled();

  return (
    <AuthProvider>
      <BrowserRouter>
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
      </BrowserRouter>
    </AuthProvider>
  );
}
