import { createClient } from '@supabase/supabase-js';

const key = process.env.SUPABASE_SERVICE_KEY;

const res = await fetch(`${process.env.VITE_SUPABASE_URL}/rest/v1/`, {
  headers: { 'apikey': key, 'Accept': 'application/openapi+json' }
});
const spec = await res.json();
const paths = spec.paths || {};

// Get all table paths
const tables = {};
for (const [path, methods] of Object.entries(paths)) {
  const tableName = path.replace(/^\//, '');
  if (tableName && !tableName.includes('{')) {
    const getMethod = methods?.get;
    if (getMethod?.responses?.['200']?.content?.['application/json']?.schema) {
      const schema = getMethod.responses['200'].content['application/json'].schema;
      const props = schema.items?.properties || schema.properties || {};
      tables[tableName] = Object.keys(props);
    }
  }
}

// Print tables relevant to our features
const relevant = ['stories', 'broadcast_channels', 'broadcast_channel_subscribers', 'broadcast_channel_updates', 'business_flyers', 'user_settings', 'notifications'];
for (const t of relevant) {
  if (tables[t]) {
    console.log(`\n=== ${t} ===`);
    console.log(`Columns: ${tables[t].join(', ')}`);
  } else {
    console.log(`\n=== ${t} === NOT FOUND in schema`);
  }
}
console.log('\n\nAll tables found:', Object.keys(tables).sort().join(', '));
