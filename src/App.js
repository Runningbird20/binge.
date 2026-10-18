import { Suspense, lazy, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { Toaster } from 'sonner';
import { Analytics } from '@vercel/analytics/react';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { MiniPlayerProvider } from './contexts/MiniPlayerContext';
import { useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import BottomNav from './components/BottomNav';
import AdBlocker from './components/AdBlocker';
import ErrorBoundary, { PageError } from './components/ErrorBoundary';
import OfflineBanner from './components/OfflineBanner';
import AnnouncementBanner from './components/AnnouncementBanner';
import KeyboardShortcuts from './components/KeyboardShortcuts';
import ReminderWatcher from './components/ReminderWatcher';
import useDeviceType from './hooks/useDeviceType';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Signup from './pages/Signup';
import './App.css';
import './theme-experiment.css';
// mobile.css loads last: it adapts the theme-experiment design language to
// small screens, so its overrides must win over both stylesheets above.
import './mobile.css';
// streaming.css (Netflix-style rows/hero/sports/player bar) builds on the
// theme-experiment tokens, so it loads after everything else.
import './streaming.css';

// Every page's code, fetched in the background once the first screen is up,
// so moving between pages never waits on a download (no loading skeleton
// between Home, Movies, Series, Sports, Books, Search, Profile…). Skipped
// with data saver / Save-Data.
const PAGE_LOADERS = [
  () => import('./pages/Home'),
  () => import('./pages/Movies'),
  () => import('./pages/TVShows'),
  () => import('./pages/Sports'),
  () => import('./pages/Books'),
  () => import('./pages/SearchResults'),
  () => import('./components/MediaOverlay'),
  () => import('./pages/Profile'),
  () => import('./pages/History'),
  () => import('./pages/Settings'),
  () => import('./pages/ReleaseCalendar'),
  () => import('./pages/Wrapped'),
];
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    if (navigator.connection?.saveData) return;
    const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1500));
    let index = 0;
    const next = () => {
      if (index >= PAGE_LOADERS.length) return;
      PAGE_LOADERS[index++]().catch(() => {}).finally(() => idle(next));
    };
    idle(next);
  }, { once: true });
}

const Home           = lazy(() => import('./pages/Home'));
const Movies         = lazy(() => import('./pages/Movies'));
const TVShows        = lazy(() => import('./pages/TVShows'));
const Books          = lazy(() => import('./pages/Books'));
const SearchResults  = lazy(() => import('./pages/SearchResults'));
const ProfilePicker  = lazy(() => import('./pages/ProfilePicker'));
const AccountSettings = lazy(() => import('./pages/AccountSettings'));
const AdminHome      = lazy(() => import('./pages/AdminHome'));
const Sports         = lazy(() => import('./pages/Sports'));
const Profile        = lazy(() => import('./pages/Profile'));
const History        = lazy(() => import('./pages/History'));
const Wrapped        = lazy(() => import('./pages/Wrapped'));
const Settings       = lazy(() => import('./pages/Settings'));
const ShareTarget    = lazy(() => import('./pages/ShareTarget'));
const ReleaseCalendar = lazy(() => import('./pages/ReleaseCalendar'));
const ImportHistory  = lazy(() => import('./pages/ImportHistory'));
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

  // Search and profile move to the bottom nav on phones (thumb reach).
  useEffect(() => {
    document.documentElement.classList.toggle('has-bottom-nav', showBottomNav);
  }, [showBottomNav]);

  return (
    <>
      <a
        href="#main"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          const main = document.querySelector('main');
          if (!main) return;
          main.setAttribute('tabindex', '-1');
          main.focus();
        }}
      >
        Skip to content
      </a>
      <OfflineBanner />
      {!NO_NAV_PATHS.includes(location.pathname) && <AnnouncementBanner />}
      <ErrorBoundary resetKey={location.pathname} fallback={PageError}>
        {children}
      </ErrorBoundary>
      {showBottomNav && <BottomNav />}
      <KeyboardShortcuts />
      {user && <ReminderWatcher />}
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
        <Route path="/history"   element={<ProtectedRoute><History /></ProtectedRoute>} />
        <Route path="/wrapped"   element={<ProtectedRoute><Wrapped /></ProtectedRoute>} />
        <Route path="/settings"  element={<ProtectedRoute><Settings /></ProtectedRoute>} />
        <Route path="/share"     element={<ProtectedRoute><ShareTarget /></ProtectedRoute>} />
        <Route path="/calendar"  element={<ProtectedRoute><ReleaseCalendar /></ProtectedRoute>} />
        <Route path="/import"    element={<ProtectedRoute><ImportHistory /></ProtectedRoute>} />
        <Route path="/account-settings" element={<ProtectedRoute><AccountSettings /></ProtectedRoute>} />
        {/* Old address for user management — now a tab in the admin panel. */}
        <Route path="/admin/users"      element={<Navigate to="/admin?tab=users" replace />} />
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

// Shaped like a browse page (billboard + rows) so the real page drops in
// without everything shifting.
function AppRouteFallback() {
  return (
    <div className="app-layout">
      <div className="page-content st-route-skel" aria-busy="true" aria-label="Loading">
        <div className="st-route-skel-hero skeleton-block" />
        {[0, 1].map((row) => (
          <div key={row} className="st-route-skel-row">
            <div className="st-route-skel-title skeleton-block" />
            <div className="st-route-skel-cards">
              {Array.from({ length: 7 }, (_, i) => (
                <div key={i} className="st-skel">
                  <div className="st-skel-art skeleton-block" />
                  <div className="st-skel-line skeleton-block" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <BrowserRouter>
          <MiniPlayerProvider>
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
          </MiniPlayerProvider>
        </BrowserRouter>
      </ToastProvider>
      <Analytics />
    </AuthProvider>
  );
}
