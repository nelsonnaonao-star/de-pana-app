import { createClient } from '@supabase/supabase-js';

const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTMxNSwiZXhwIjoyMDk2NDM3MzE1fQ._iezAn0MaaMbVo-V98JwU1aOFpEGeXO3dn-EvxYpN9g';
const supabase = createClient('https://akgsylutbpgolurkcavh.supabase.co', key);

const tables = ['stories', 'channels', 'channel_subscribers', 'channel_updates', 'business_flyers', 'user_settings', 'notifications'];

for (const t of tables) {
  const { data, error } = await supabase.from(t).select('*').limit(1);
  if (data && data.length > 0) {
    console.log(`\n=== ${t} (columns: ${Object.keys(data[0]).join(', ')}) ===`);
    console.log(JSON.stringify(data[0], null, 2));
  } else if (!error) {
    console.log(`\n=== ${t} === (empty table, no rows)`);
    // Try to get column info via a raw query
    const { data: colData } = await supabase.from(t).select('*').limit(0);
    console.log('Table exists but empty');
  } else {
    console.log(`\n=== ${t} === ERROR: ${error.message}`);
  }
}
