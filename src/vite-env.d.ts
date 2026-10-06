/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_REALTIME_PROVIDER?: 'ws' | 'supabase';
  readonly VITE_WS_URL?: string;
  readonly VITE_PUBLIC_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
