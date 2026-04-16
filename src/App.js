import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import './App.css';

const ChatBot = lazy(() => import('./components/ChatBot'));
const Home = lazy(() => import('./pages/Home'));
const Movies = lazy(() => import('./pages/Movies'));
const TVShows = lazy(() => import('./pages/TVShows'));
const Books = lazy(() => import('./pages/Books'));
const Watchlist = lazy(() => import('./pages/Watchlist'));
const Following = lazy(() => import('./pages/Following'));
const Lists = lazy(() => import('./pages/Lists'));
const SharedList = lazy(() => import('./pages/SharedList'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const AdminRequests = lazy(() => import('./pages/AdminRequests'));
const LiveTV = lazy(() => import('./pages/LiveTV'));
const Forum = lazy(() => import('./pages/Forum'));
const Ratings = lazy(() => import('./pages/Ratings'));
const DeveloperLab = lazy(() => import('./pages/DeveloperLab'));
const AdminHome = lazy(() => import('./pages/AdminHome'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));

function AppRouteFallback() {
  return <div className="loading-state">Loading the app...</div>;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Suspense fallback={<AppRouteFallback />}>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/home" element={<ProtectedRoute allowedUserTypes={['user']}><Home /></ProtectedRoute>} />
            <Route path="/movies" element={<ProtectedRoute><Movies /></ProtectedRoute>} />
            <Route path="/tv-shows" element={<ProtectedRoute><TVShows /></ProtectedRoute>} />
            <Route path="/books" element={<ProtectedRoute><Books /></ProtectedRoute>} />
            <Route path="/ratings" element={<ProtectedRoute><Ratings /></ProtectedRoute>} />
            <Route path="/watchlist" element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
            <Route path="/following" element={<ProtectedRoute><Following /></ProtectedRoute>} />
            <Route path="/forum" element={<ProtectedRoute><Forum /></ProtectedRoute>} />
            <Route path="/forum/:slug" element={<ProtectedRoute><Forum /></ProtectedRoute>} />
            <Route path="/forum/:slug/post/:postId" element={<ProtectedRoute><Forum /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute allowedUserTypes={['user']}><AdminHome /></ProtectedRoute>} />
            <Route path="/lists" element={<ProtectedRoute><Lists /></ProtectedRoute>} />
            <Route path="/lists/:shareCode" element={<SharedList />} />
            <Route path="/account-settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
            <Route path="/admin/requests" element={<ProtectedRoute allowedUserTypes={['user']}><AdminRequests /></ProtectedRoute>} />
            <Route path="/admin/analytics" element={<ProtectedRoute allowedUserTypes={['user']}><AdminAnalytics /></ProtectedRoute>} />
            <Route path="/live-tv" element={<ProtectedRoute><LiveTV /></ProtectedRoute>} />
            <Route
              path="/__ops/dev-lab"
              element={<ProtectedRoute allowedUserTypes={['dev', 'admin']}><DeveloperLab /></ProtectedRoute>}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <ChatBot />
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
