import { createClient } from '@supabase/supabase-js';

const key = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(process.env.VITE_SUPABASE_URL, key);

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
