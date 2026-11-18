import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import AuthCallback from './auth/AuthCallback';
import { configureApiClient, MOCK } from './api/client';
import { ToastProvider } from './store/Toast';
import { StoreProvider, useStore } from './store/Store';
import { UIProvider } from './store/UI';
import { Shell } from './components/Shell';
import Home from './pages/Home';
import Agenda from './pages/Agenda';
import Trips from './pages/Trips';
import TripPage from './pages/TripPage';
import Routines from './pages/Routines';
import PersonPage from './pages/PersonPage';
import SubjectPage from './pages/SubjectPage';
import Contacts from './pages/Contacts';
import Documents from './pages/Documents';
import './styles.css';

/** Wires the api client to auth and redirects to Cognito when signed out. */
function Protected({ children }: { children: React.ReactNode }) {
  const { getAccessToken, login } = useAuth();
  if (MOCK) {
    configureApiClient(() => 'mock', () => {});
    return <>{children}</>;
  }
  // Wire synchronously during render: child effects (the first fetch) run
  // before parent effects.
  configureApiClient(getAccessToken, login);
  if (!getAccessToken()) {
    login();
    return <p className="boot">Redirecting to sign in…</p>;
  }
  return <>{children}</>;
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function Pages() {
  const { ready, loadError, reload } = useStore();
  if (!ready) return <p className="boot">Loading…</p>;
  if (loadError)
    return (
      <div className="boot">
        <p>{loadError}</p>
        <button type="button" className="btn secondary" onClick={reload}>
          Try again
        </button>
      </div>
    );
  return (
    <Shell>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/agenda" element={<Agenda />} />
        <Route path="/trips" element={<Trips />} />
        <Route path="/trips/:id" element={<TripPage />} />
        <Route path="/routines" element={<Routines />} />
        <Route path="/documents" element={<Documents />} />
        <Route path="/people/:id" element={<PersonPage page="overview" />} />
        <Route path="/people/:id/health" element={<PersonPage page="health" />} />
        <Route path="/people/:id/identity" element={<PersonPage page="identity" />} />
        <Route path="/cars/:id" element={<SubjectPage page="overview" />} />
        <Route path="/cars/:id/documents" element={<SubjectPage page="documents" />} />
        {/* Any other subject type from the registry. */}
        <Route path="/subjects/:id" element={<SubjectPage page="overview" />} />
        <Route path="/subjects/:id/documents" element={<SubjectPage page="documents" />} />
        <Route path="/contacts" element={<Contacts />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}

function AppRoutes() {
  const location = useLocation();
  if (location.pathname === '/callback') {
    return (
      <Routes>
        <Route path="/callback" element={<AuthCallback />} />
      </Routes>
    );
  }
  return (
    <Protected>
      <ToastProvider>
        <StoreProvider>
          <UIProvider>
            <Pages />
          </UIProvider>
        </StoreProvider>
      </ToastProvider>
    </Protected>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
