import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://akgsylutbpgolurkcavh.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

export const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

export async function initDb() {
  // Ensure password_reset_codes table exists via Supabase RPC
  try {
    await supabaseAdmin.rpc('init_password_reset_codes');
  } catch {
    // Table may already exist or RPC may not exist — that's fine
    // The table should be created via Supabase dashboard migration
  }
  return supabaseAdmin;
}

export async function getOne(table, filters = {}) {
  let query = supabaseAdmin.from(table).select('*');
  for (const [key, value] of Object.entries(filters)) {
    if (value && typeof value === 'object' && value.op) {
      switch (value.op) {
        case 'neq': query = query.neq(key, value.value); break;
        case 'gt': query = query.gt(key, value.value); break;
        case 'gte': query = query.gte(key, value.value); break;
        case 'like': query = query.like(key, value.value); break;
        case 'ilike': query = query.ilike(key, value.value); break;
        default: query = query.eq(key, value.value);
      }
    } else {
      query = query.eq(key, value);
    }
  }
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  return data;
}

export async function getAll(table, filters = {}, options = {}) {
  let query = supabaseAdmin.from(table).select('*');
  for (const [key, value] of Object.entries(filters)) {
    if (value && typeof value === 'object' && value.op) {
      switch (value.op) {
        case 'neq': query = query.neq(key, value.value); break;
        case 'gt': query = query.gt(key, value.value); break;
        case 'gte': query = query.gte(key, value.value); break;
        case 'like': query = query.like(key, value.value); break;
        case 'ilike': query = query.ilike(key, value.value); break;
        default: query = query.eq(key, value);
      }
    } else {
      query = query.eq(key, value);
    }
  }
  if (options.orderBy) {
    query = query.order(options.orderBy, { ascending: options.ascending ?? false });
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function run(table, data) {
  const { data: result, error } = await supabaseAdmin
    .from(table)
    .insert(data)
    .select()
    .single();
  if (error) throw error;
  return result;
}

export async function updateOne(table, updates, filters) {
  let query = supabaseAdmin.from(table).update(updates);
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  const { error } = await query;
  if (error) throw error;
}

export async function deleteOne(table, filters) {
  let query = supabaseAdmin.from(table).delete();
  for (const [key, value] of Object.entries(filters)) {
    query = query.eq(key, value);
  }
  const { error } = await query;
  if (error) throw error;
}

export default { getOne, getAll, run, updateOne, deleteOne, initDb, supabaseAdmin };
