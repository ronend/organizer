import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

const TOKEN_KEY = 'accessToken';

export interface CognitoUser {
  sub: string;
  username?: string;
}

interface AuthContextValue {
  user: CognitoUser | null;
  accessToken: string | null;
  login: () => void;
  logout: () => void;
  /** Returns a valid (non-expired) access token, or null if logged out. */
  getAccessToken: () => string | null;
  /** Persist a freshly exchanged token (used by the /callback flow). */
  setAccessToken: (token: string) => void;
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  accessToken: null,
  login: () => {},
  logout: () => {},
  getAccessToken: () => null,
  setAccessToken: () => {},
});

const env = import.meta.env;

/** Decode a JWT payload without a library (per spec: atob). */
function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split('.')[1];
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** True if the token has no exp claim or exp is in the past. */
function isExpired(token: string): boolean {
  const claims = decodeJwt(token);
  if (!claims || typeof claims.exp !== 'number') return true;
  // exp is in seconds since epoch.
  return claims.exp * 1000 <= Date.now();
}

function userFromToken(token: string): CognitoUser | null {
  const claims = decodeJwt(token);
  if (!claims || typeof claims.sub !== 'string') return null;
  return {
    sub: claims.sub,
    username: typeof claims.username === 'string' ? claims.username : undefined,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [accessToken, setTokenState] = useState<string | null>(null);
  const [user, setUser] = useState<CognitoUser | null>(null);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setTokenState(null);
    setUser(null);
    // Redirect to the Cognito logout endpoint.
    const params = new URLSearchParams({
      client_id: env.VITE_COGNITO_CLIENT_ID,
      logout_uri: env.VITE_APP_URL,
    });
    window.location.href = `${env.VITE_COGNITO_DOMAIN}/logout?${params.toString()}`;
  }, []);

  const login = useCallback(() => {
    const params = new URLSearchParams({
      client_id: env.VITE_COGNITO_CLIENT_ID,
      response_type: 'code',
      scope: 'openid email',
      redirect_uri: `${env.VITE_APP_URL}/callback`,
    });
    window.location.href = `${env.VITE_COGNITO_DOMAIN}/login?${params.toString()}`;
  }, []);

  const setAccessToken = useCallback((token: string) => {
    localStorage.setItem(TOKEN_KEY, token);
    setTokenState(token);
    setUser(userFromToken(token));
  }, []);

  const getAccessToken = useCallback((): string | null => {
    const token = accessToken ?? localStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    if (isExpired(token)) {
      logout();
      return null;
    }
    return token;
  }, [accessToken, logout]);

  // On mount: hydrate from localStorage, validate expiry.
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) return;
    if (isExpired(stored)) {
      logout();
      return;
    }
    setTokenState(stored);
    setUser(userFromToken(stored));
  }, [logout]);

  const value = useMemo(
    () => ({ user, accessToken, login, logout, getAccessToken, setAccessToken }),
    [user, accessToken, login, logout, getAccessToken, setAccessToken],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
