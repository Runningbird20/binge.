import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import BottomNav from './components/BottomNav';
import GlobalSearch from './components/GlobalSearch';
import AdBlocker from './components/AdBlocker';
import PopupShield from './components/PopupShield';
import useDeviceType from './hooks/useDeviceType';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import './App.css';
import './mobile.css';

const ChatBot        = lazy(() => import('./components/ChatBot'));
const Home           = lazy(() => import('./pages/Home'));
const Movies         = lazy(() => import('./pages/Movies'));
const TVShows        = lazy(() => import('./pages/TVShows'));
const Books          = lazy(() => import('./pages/Books'));
const Following      = lazy(() => import('./pages/Following'));
const Lists          = lazy(() => import('./pages/Lists'));
const SharedList     = lazy(() => import('./pages/SharedList'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const AdminRequests  = lazy(() => import('./pages/AdminRequests'));
const AdminHome      = lazy(() => import('./pages/AdminHome'));
const AdminUsers     = lazy(() => import('./pages/AdminUsers'));
const LiveTV         = lazy(() => import('./pages/LiveTV'));
const Sports         = lazy(() => import('./pages/Sports'));
const Ratings        = lazy(() => import('./pages/Ratings'));
const Watchlist      = lazy(() => import('./pages/Watchlist'));
const UserProfile    = lazy(() => import('./pages/UserProfile'));
const WatchRoom      = lazy(() => import('./pages/WatchRoom'));
const YearInReview   = lazy(() => import('./pages/YearInReview'));

// Routes where we never show the bottom nav
const NO_NAV_PATHS = ['/', '/login', '/signup'];

function AppShell({ children }) {
  const { isMobile } = useDeviceType();
  const { user }     = useAuth();
  const location     = useLocation();
  const showBottomNav = isMobile && !!user && !NO_NAV_PATHS.includes(location.pathname);

  return (
    <>
      {children}
      {/* GlobalSearch mounted at root level on mobile so its overlay
          isn't trapped inside a display:none navbar container */}
      {isMobile && user && <GlobalSearch />}
      {showBottomNav && <BottomNav />}
    </>
  );
}

function AppRouteFallback() {
  return (
    <div className="app-layout">
      <div className="route-skeleton">
        <div className="route-skeleton-bar skeleton-block" />
        <div className="route-skeleton-bar route-skeleton-bar--short skeleton-block" />
        <div className="route-skeleton-grid">
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i} className="route-skeleton-card skeleton-block" />
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PopupShield />
      <ToastProvider>
        <BrowserRouter>
          <Suspense fallback={<AppRouteFallback />}>
            <AppShell>
              <AdBlocker />
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
                <Route path="/admin/users"      element={<ProtectedRoute><AdminUsers /></ProtectedRoute>} />
                <Route path="/admin"            element={<ProtectedRoute><AdminHome /></ProtectedRoute>} />
                <Route path="/profile/:username"        element={<ProtectedRoute><UserProfile /></ProtectedRoute>} />
                <Route path="/watch-room"               element={<ProtectedRoute><WatchRoom /></ProtectedRoute>} />
                <Route path="/year-in-review"           element={<ProtectedRoute><YearInReview /></ProtectedRoute>} />
                <Route path="/watch-room/:roomId"       element={<ProtectedRoute><WatchRoom /></ProtectedRoute>} />
                <Route path="/admin/requests"  element={<ProtectedRoute allowedUserTypes={['admin']}><AdminRequests /></ProtectedRoute>} />
                <Route path="/live-tv" element={<ProtectedRoute><LiveTV /></ProtectedRoute>} />
                <Route path="/sports"  element={<ProtectedRoute><Sports /></ProtectedRoute>} />
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
            </AppShell>
          </Suspense>

          {/* Sonner toasts — positioned above bottom nav on mobile */}
          <Toaster
            theme="dark"
            position="bottom-center"
            offset={{ bottom: 80 }}
            toastOptions={{
              style: {
                background: '#1c1c1e',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#fff',
                borderRadius: '12px',
                fontSize: '14px',
              },
            }}
          />
        </BrowserRouter>
      </ToastProvider>
    </AuthProvider>
  );
}
