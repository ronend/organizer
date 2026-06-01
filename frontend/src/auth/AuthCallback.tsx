import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';

interface TokenResponse {
  accessToken: string;
  idToken: string;
  expiresIn: number;
}

/**
 * Rendered at /callback. Reads the ?code= returned by the Cognito hosted UI,
 * exchanges it for tokens via the backend, stores the access token, and
 * redirects home.
 */
export default function AuthCallback() {
  const { setAccessToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  // Guard against React StrictMode double-invocation (codes are single-use).
  const exchanged = useRef(false);

  useEffect(() => {
    if (exchanged.current) return;
    exchanged.current = true;

    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      setError('Missing authorization code in callback URL.');
      return;
    }

    (async () => {
      try {
        const res = await fetch('/api/auth/token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        });
        if (!res.ok) {
          throw new Error(`Token exchange failed (${res.status})`);
        }
        const data: TokenResponse = await res.json();
        setAccessToken(data.accessToken);
        navigate('/', { replace: true });
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Token exchange failed.');
      }
    })();
  }, [navigate, setAccessToken]);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>
        <h2>Sign-in failed</h2>
        <p style={{ color: '#b00' }}>{error}</p>
        <a href="/">Return home</a>
      </div>
    );
  }

  return (
    <div style={{ padding: '2rem', textAlign: 'center' }}>
      <div className="spinner" aria-label="Signing in" />
      <p>Signing you in…</p>
    </div>
  );
}
