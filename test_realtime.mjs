import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://akgsylutbpgolurkcavh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4NjEzMTUsImV4cCI6MjA5NjQzNzMxNX0.2HhVDU7YYHM7zpcN8Moh8QCwEwhMH5bPj6leFqxzApo'
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
