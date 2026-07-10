import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  'https://akgsylutbpgolurkcavh.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTMxNSwiZXhwIjoyMDk2NDM3MzE1fQ._iezAn0MaaMbVo-V98JwU1aOFpEGeXO3dn-EvxYpN9g'
);

async function main() {
  const res = await fetch('https://akgsylutbpgolurkcavh.supabase.co/sql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apiKey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTMxNSwiZXhwIjoyMDk2NDM3MzE1fQ._iezAn0MaaMbVo-V98JwU1aOFpEGeXO3dn-EvxYpN9g',
      'Authorization': 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFrZ3N5bHV0YnBnb2x1cmtjYXZoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MDg2MTMxNSwiZXhwIjoyMDk2NDM3MzE1fQ._iezAn0MaaMbVo-V98JwU1aOFpEGeXO3dn-EvxYpN9g'
    },
    body: JSON.stringify({ query: "SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';" })
  });
  const text = await res.text();
  console.log('Status:', res.status);
  console.log('Result:', text.substring(0, 2000));
}
main().catch(console.error);
