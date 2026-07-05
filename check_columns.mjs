import { createClient } from '@supabase/supabase-js';

const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTMxNSwiZXhwIjoyMDk2NDM3MzE1fQ._iezAn0MaaMbVo-V98JwU1aOFpEGeXO3dn-EvxYpN9g';
const supabase = createClient('https://akgsylutbpgolurkcavh.supabase.co', key);

// Try to insert a test row to get the column info back
const tables = ['stories', 'channels', 'channel_subscribers', 'channel_updates', 'business_flyers', 'user_settings', 'notifications'];

for (const t of tables) {
  // Try inserting a minimal row and getting the representation
  const { data, error } = await supabase.from(t).insert({}).select('*');
  if (error) {
    console.log(`\n=== ${t} ===`);
    console.log(`Insert error: ${error.message}`);
    // Try just describing via a raw POST with prefer: return=minimal
  } else {
    console.log(`\n=== ${t} ===`);
    console.log(JSON.stringify(data, null, 2));
  }
}
