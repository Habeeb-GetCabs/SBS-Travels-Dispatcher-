import { createClient, SupabaseClient } from '@supabase/supabase-js';

const envUrl = import.meta.env.VITE_SUPABASE_URL || '';
const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Check local storage for runtime-provided keys if not in env
const localUrl = typeof window !== 'undefined' ? localStorage.getItem('sbs_supabase_url') || '' : '';
const localKey = typeof window !== 'undefined' ? localStorage.getItem('sbs_supabase_anon_key') || '' : '';

export const supabaseUrl = envUrl || localUrl;
export const supabaseAnonKey = envKey || localKey;

export const isSupabaseConfigured = (): boolean => {
  return (
    Boolean(supabaseUrl) &&
    Boolean(supabaseAnonKey) &&
    !supabaseUrl.includes('your-project.supabase.co') &&
    supabaseUrl.startsWith('https://')
  );
};

export const createSupabaseClient = (url?: string, key?: string): SupabaseClient | null => {
  const targetUrl = url || supabaseUrl;
  const targetKey = key || supabaseAnonKey;
  if (!targetUrl || !targetKey || targetUrl.includes('your-project.supabase.co')) {
    return null;
  }
  return createClient(targetUrl, targetKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
    },
    realtime: {
      params: {
        eventsPerSecond: 10,
      },
    },
  });
};

export const supabase: SupabaseClient | null = isSupabaseConfigured()
  ? createSupabaseClient()
  : null;

export const saveSupabaseConfig = (url: string, key: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem('sbs_supabase_url', url.trim());
    localStorage.setItem('sbs_supabase_anon_key', key.trim());
    window.location.reload();
  }
};

export const clearSupabaseConfig = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('sbs_supabase_url');
    localStorage.removeItem('sbs_supabase_anon_key');
    window.location.reload();
  }
};
