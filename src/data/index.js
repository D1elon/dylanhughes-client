// Picks where the portal's data lives: Supabase once js/config.js is filled in, this browser until then.
import { makeDemo } from './demo.js';

export async function getApi() {
  const config = window.PORTAL_CONFIG || {};
  if (config.supabaseUrl && config.supabaseKey) {
    const { makeSupabase } = await import('./supabase.js');
    return makeSupabase(config);
  }
  return makeDemo();
}
