import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { MiniPlayerProvider } from './contexts/MiniPlayerContext';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import BottomNav from './components/BottomNav';
import AdBlocker from './components/AdBlocker';
import useDeviceType from './hooks/useDeviceType';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import './App.css';
import './theme-experiment.css';
// mobile.css loads last: it adapts the theme-experiment design language to
// small screens, so its overrides must win over both stylesheets above.
import './mobile.css';

const Home           = lazy(() => import('./pages/Home'));
const Movies         = lazy(() => import('./pages/Movies'));
const TVShows        = lazy(() => import('./pages/TVShows'));
const Books          = lazy(() => import('./pages/Books'));
const SearchResults  = lazy(() => import('./pages/SearchResults'));
const ProfilePicker  = lazy(() => import('./pages/ProfilePicker'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const AdminHome      = lazy(() => import('./pages/AdminHome'));
const AdminUsers     = lazy(() => import('./pages/AdminUsers'));
const Sports         = lazy(() => import('./pages/Sports'));
const Profile        = lazy(() => import('./pages/Profile'));
const MediaOverlay   = lazy(() => import('./components/MediaOverlay'));
// TEMP (UI preview only — do not commit)
const UIPreview      = lazy(() => import('./pages/__UIPreview'));

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
      {showBottomNav && <BottomNav />}
    </>
  );
}

// Movie/TV/book detail routes, registered both in the main switch (so a
// direct link/refresh still works) and — when a backgroundLocation is
// present — in a second overlay switch so the modal renders on top of
// whatever page the user was already on instead of navigating away.
function MediaOverlayRoutes() {
  return (
    <>
      <Route path="/movie/:id"   element={<ProtectedRoute><MediaOverlay mediaType="movie" /></ProtectedRoute>} />
      <Route path="/tv-show/:id" element={<ProtectedRoute><MediaOverlay mediaType="tv_show" /></ProtectedRoute>} />
      <Route path="/book/:id"    element={<ProtectedRoute><MediaOverlay mediaType="book" /></ProtectedRoute>} />
    </>
  );
}

function AppRoutes() {
  const location = useLocation();
  const backgroundLocation = location.state?.backgroundLocation;

  return (
    <>
      <Routes location={backgroundLocation || location}>
        <Route path="/"          element={<Landing />} />
        <Route path="/login"     element={<Login />} />
        <Route path="/signup"    element={<Signup />} />
        <Route path="/home"      element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/movies"    element={<ProtectedRoute><Movies /></ProtectedRoute>} />
        <Route path="/tv-shows"  element={<ProtectedRoute><TVShows /></ProtectedRoute>} />
        <Route path="/books"     element={<ProtectedRoute><Books /></ProtectedRoute>} />
        <Route path="/search"    element={<ProtectedRoute><SearchResults /></ProtectedRoute>} />
        <Route path="/profiles"  element={<ProtectedRoute><ProfilePicker /></ProtectedRoute>} />
        <Route path="/profile"   element={<ProtectedRoute><Profile /></ProtectedRoute>} />
        <Route path="/account-settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
        <Route path="/admin/users"      element={<ProtectedRoute allowedUserTypes={['admin']}><AdminUsers /></ProtectedRoute>} />
        <Route path="/admin"            element={<ProtectedRoute allowedUserTypes={['admin']}><AdminHome /></ProtectedRoute>} />
        {/* TEMP (UI preview only — do not commit) */}
        <Route path="/ui-preview" element={<UIPreview />} />
        <Route path="/sports"  element={<ProtectedRoute><Sports /></ProtectedRoute>} />
        {MediaOverlayRoutes()}
        <Route path="*" element={
          <div className="app-layout">
            <div className="page-content" style={{display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',minHeight:'60vh',textAlign:'center',gap:'1rem'}}>
              <p style={{fontSize:'3rem'}}>🔍</p>
              <h2 style={{color:'#e0e0e0',margin:0}}>Page not found</h2>
              <p style={{color:'#555',margin:0}}>The page you're looking for doesn't exist.</p>
              <a href="/home" style={{color:'#f4f6f8',fontSize:'0.9rem'}}>← Go home</a>
            </div>
          </div>
        } />
      </Routes>

      {backgroundLocation && (
        <Routes>
          {MediaOverlayRoutes()}
        </Routes>
      )}
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
      <ToastProvider>
        <MiniPlayerProvider>
          <BrowserRouter>
            <Suspense fallback={<AppRouteFallback />}>
              <AppShell>
                <AdBlocker />
                <AppRoutes />
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
        </MiniPlayerProvider>
      </ToastProvider>
    </AuthProvider>
  );
}
