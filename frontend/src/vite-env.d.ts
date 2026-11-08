/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_COGNITO_DOMAIN: string;
  readonly VITE_COGNITO_CLIENT_ID: string;
  readonly VITE_APP_URL: string;
  /** '1' serves the API from an in-browser mock (npm run dev:mock). */
  readonly VITE_LOCAL_MOCK?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
