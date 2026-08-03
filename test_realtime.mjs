import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

console.log('Testing Realtime subscription...');
const channel = supabase.channel('test-sub');
channel.on('postgres_changes', {
  event: 'INSERT',
  schema: 'public',
  table: 'messages'
}, (payload) => {
  console.log('REALTIME EVENT RECEIVED!', JSON.stringify(payload));
});

channel.subscribe((status) => {
  console.log('Subscription status:', status);
  if (status === 'SUBSCRIBED') {
    console.log('Successfully subscribed! Messages table IS in publication.');
  } else if (status === 'CHANNEL_ERROR') {
    console.log('ERROR: Could not subscribe. Messages table might NOT be in publication.');
  }
});

// Keep alive for 10 seconds
await new Promise(r => setTimeout(r, 10000));
console.log('Done testing.');
supabase.removeChannel(channel);
process.exit(0);
