import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import './App.css';

const ChatBot        = lazy(() => import('./components/ChatBot'));
const Home           = lazy(() => import('./pages/Home'));
const Movies         = lazy(() => import('./pages/Movies'));
const TVShows        = lazy(() => import('./pages/TVShows'));
const Books          = lazy(() => import('./pages/Books'));
const Watchlist      = lazy(() => import('./pages/Watchlist'));
const Following      = lazy(() => import('./pages/Following'));
const Lists          = lazy(() => import('./pages/Lists'));
const SharedList     = lazy(() => import('./pages/SharedList'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const AdminRequests  = lazy(() => import('./pages/AdminRequests'));
const AdminHome      = lazy(() => import('./pages/AdminHome'));
const AdminAnalytics = lazy(() => import('./pages/AdminAnalytics'));
const AdminUsers     = lazy(() => import('./pages/AdminUsers'));
const LiveTV         = lazy(() => import('./pages/LiveTV'));
const Ratings        = lazy(() => import('./pages/Ratings'));
const Forum          = lazy(() => import('./pages/Forum'));
const UserProfile    = lazy(() => import('./pages/UserProfile'));
const WatchRoom      = lazy(() => import('./pages/WatchRoom'));

function AppRouteFallback() {
  return <div className="loading-state">Loading...</div>;
}

export default function App() {
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
            <Route path="/following" element={<ProtectedRoute><Following /></ProtectedRoute>} />
            <Route path="/lists"     element={<ProtectedRoute><Lists /></ProtectedRoute>} />
            <Route path="/lists/:shareCode" element={<SharedList />} />
            <Route path="/account-settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
            <Route path="/admin/requests"   element={<ProtectedRoute><AdminRequests /></ProtectedRoute>} />
            <Route path="/admin/analytics"  element={<ProtectedRoute><AdminAnalytics /></ProtectedRoute>} />
            <Route path="/admin/users"      element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
            <Route path="/admin"            element={<ProtectedRoute><AdminHome /></ProtectedRoute>} />
            <Route path="/live-tv"          element={<ProtectedRoute><LiveTV /></ProtectedRoute>} />
            <Route path="/forum"                    element={<ProtectedRoute><Forum /></ProtectedRoute>} />
            <Route path="/forum/:slug"              element={<ProtectedRoute><Forum /></ProtectedRoute>} />
            <Route path="/forum/:slug/post/:postId" element={<ProtectedRoute><Forum /></ProtectedRoute>} />
            <Route path="/profile/:username"        element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
            <Route path="/watch-room"               element={<ProtectedRoute><WatchRoom /></ProtectedRoute>} />
            <Route path="/watch-room/:roomId"       element={<ProtectedRoute><WatchRoom /></ProtectedRoute>} />
            <Route path="*" element={
              <div className="app-layout">
                <div className="page-content" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'60vh',textAlign:'center',gap:'1rem'}}>
                  <p style={{fontSize:'3rem'}}>🔍</p>
                  <h2 style={{color:'#e0e0e0',margin:0}}>Page not found</h2>
                  <p style={{color:'#555',margin:0}}>The page you're looking for doesn't exist.</p>
                  <a href="/home" style={{color:'#e8c97a',fontSize:'0.9rem'}}>← Go home</a>
                </div>
              </div>
            } />
          </Routes>
          <ChatBot />
        </Suspense>
      </BrowserRouter>
    </AuthProvider>
  );
}
