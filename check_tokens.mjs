import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://akgsylutbpgolurkcavh.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTMxNSwiZXhwIjoyMDk2NDM3MzE1fQ._iezAn0MaaMbVo-V98JwU1aOFpEGeXO3dn-EvxYpN9g';

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function checkTokens() {
  const profileId = '152321e9-b152-4c29-8c1f-ef3f5839d3d2';
  
  // Check push_tokens table
  const { data, error } = await supabase
    .from('push_tokens')
    .select('*')
    .eq('profile_id', profileId);
    
  if (error) {
    console.error('Error:', error);
    return;
  }
  
  console.log('Push tokens for user:', data);
  
  if (data && data.length > 0) {
    // Try sending FCM directly using the token
    for (const token of data) {
      console.log('Found token:', token.token.substring(0, 20) + '...');
    }
  } else {
    console.log('No tokens registered for this user');
  }
}

checkTokens();