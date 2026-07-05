import { createClient } from '@supabase/supabase-js';

const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTMxNSwiZXhwIjoyMDk2NDM3MzE1fQ._iezAn0MaaMbVo-V98JwU1aOFpEGeXO3dn-EvxYpN9g';
const supabase = createClient('https://akgsylutbpgolurkcavh.supabase.co', key);

// Check which tables we can actually query
const tables = ['stories', 'channels', 'channel_subscribers', 'channel_updates', 'business_flyers', 'user_settings', 'notifications'];

for (const t of tables) {
  // Try with different approach - select count directly
  const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
  if (error) {
    console.log(`[FAIL] ${t}: ${error.message} (code: ${error.code})`);
  } else {
    console.log(`[OK] ${t}: ${count} rows`);
  }
}
