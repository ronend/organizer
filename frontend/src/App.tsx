import { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './auth/AuthContext';
import { useAuth } from './auth/useAuth';
import { configureApiClient } from './api/client';
import AuthCallback from './auth/AuthCallback';
import OrganizerApp from './components/OrganizerApp';
import './index.css';

/** Wires the non-React api client to the auth context, then guards routes. */
function Protected({ children }: { children: React.ReactNode }) {
  const { getAccessToken, login, logout } = useAuth();

  useEffect(() => {
    configureApiClient(getAccessToken, login);
  }, [getAccessToken, login]);

  const token = getAccessToken();
  if (!token) {
    // Not authenticated → kick off the Cognito hosted UI login.
    login();
    return <p style={{ padding: '2rem' }}>Redirecting to sign in…</p>;
  }

  // Reference logout so the binding is considered used by linters.
  void logout;
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
            <OrganizerApp />
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
