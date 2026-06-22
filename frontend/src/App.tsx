import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import { configureApiClient } from './api/client';
import AuthCallback from './auth/AuthCallback';
import EventApp from './components/EventApp';
import './index.css';

/** Wires the non-React api client to the auth context, then guards routes. */
function Protected({ children }: { children: React.ReactNode }) {
  const { getAccessToken, login } = useAuth();

  // Wire the api client SYNCHRONOUSLY during render — not in an effect. Child
  // effects (useEvents' first fetch) run before parent effects, so an
  // effect here would leave the token getter unset on the initial request.
  configureApiClient(getAccessToken, login);

  const token = getAccessToken();
  if (!token) {
    // Not authenticated → kick off the Cognito hosted UI login.
    login();
    return <p style={{ padding: '2rem' }}>Redirecting to sign in…</p>;
  }

  return <>{children}</>;
}

function AppRoutes() {
  const location = useLocation();

  // /callback is the only unprotected route.
  if (location.pathname === '/callback') {
    return (
      <Routes>
        <Route path="/callback" element={<AuthCallback />} />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route
        path="/"
        element={
          <Protected>
            <EventApp />
          </Protected>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
