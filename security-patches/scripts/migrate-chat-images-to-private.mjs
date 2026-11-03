#!/usr/bin/env node
// ============================================================
// PARCHE 01 - Migrar media de chat de chat-images (público)
//                a chat-media (privado)
//
// Uso:
//   node security-patches/scripts/migrate-chat-images-to-private.mjs
//     -> dry-run: solo lista qué haría (NO escribe nada)
//
//   node security-patches/scripts/migrate-chat-images-to-private.mjs --apply
//     -> copia objetos referenciados y actualiza messages.attachment_url
//
//   node security-patches/scripts/migrate-chat-images-to-private.mjs --apply --delete-originals
//     -> además borra los originales de chat-images SOLO si ya no
//        quedan mensajes que los referencien.
//
// Requisitos:
//   - server/.env con VITE_SUPABASE_URL y SUPABASE_SERVICE_KEY
//     (o variables de entorno equivalentes).
//   - service_role: bypassa RLS. No imprimir claves.
//
// Idempotente: solo procesa mensajes que aún apuntan a chat-images.
// No migra objetos huérfanos del bucket; para eso usar el Dashboard.
// ============================================================

import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const serverDir = path.join(repoRoot, 'server');
const requireFromServer = createRequire(path.join(serverDir, 'package.json'));

for (const envPath of [path.join(serverDir, '.env'), path.join(repoRoot, '.env')]) {
  try {
    await fs.access(envPath);
    requireFromServer('dotenv').config({ path: envPath, quiet: true });
  } catch {
    // archivo opcional
  }
}

const { createClient } = requireFromServer('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const DELETE_ORIGINALS = process.argv.includes('--delete-originals');

if (DELETE_ORIGINALS && !APPLY) {
  console.error('ERROR: --delete-originals requiere --apply');
  process.exit(1);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error('ERROR: faltan VITE_SUPABASE_URL y/o SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PUBLIC_BUCKET = 'chat-images';
const PRIVATE_BUCKET = 'chat-media';
const PAGE_SIZE = 200;

function objectPathFromPublicUrl(url) {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${PUBLIC_BUCKET}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  const raw = url.slice(idx + marker.length).split('?')[0];
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function extensionOf(objectPath) {
  const base = objectPath.split('/').pop() || '';
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx);
}

function mimeFromPath(objectPath) {
  const ext = extensionOf(objectPath).toLowerCase();
  const map = {
    '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
    '.webp': 'image/webp', '.gif': 'image/gif', '.heic': 'image/heic',
    '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
    '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4',
    '.wav': 'audio/wav', '.pdf': 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

async function fetchReferencedMessages() {
  const rows = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, chat_id, attachment_url, created_at')
      .ilike('attachment_url', `%/${PUBLIC_BUCKET}/%`)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function countRemainingRefs(objectPath) {
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .ilike('attachment_url', `%/${PUBLIC_BUCKET}/${objectPath}%`);
  if (error) throw error;
  return count || 0;
}

async function main() {
  console.log(`Modo: ${APPLY ? 'APLICAR' : 'DRY-RUN (no escribe)'}`);
  console.log(`Bucket origen: ${PUBLIC_BUCKET} -> destino: ${PRIVATE_BUCKET}`);

  const messages = await fetchReferencedMessages();
  console.log(`Mensajes referenciando ${PUBLIC_BUCKET}: ${messages.length}`);

  const byObject = new Map();
  for (const msg of messages) {
    const objectPath = objectPathFromPublicUrl(msg.attachment_url);
    if (!objectPath || !msg.chat_id) continue;
    const entry = byObject.get(objectPath) || {
      objectPath,
      chatId: msg.chat_id,
      messageIds: [],
      oldUrl: msg.attachment_url,
    };
    entry.messageIds.push(msg.id);
    byObject.set(objectPath, entry);
  }

  const objects = [...byObject.values()];
  console.log(`Objetos únicos: ${objects.length}`);
  console.log(`Chats afectados: ${new Set(objects.map(o => o.chatId)).size}`);

  if (!APPLY) {
    for (const obj of objects.slice(0, 10)) {
      console.log(`  - ${obj.objectPath} (${obj.messageIds.length} mensaje/s)`);
    }
    if (objects.length > 10) console.log(`  ... y ${objects.length - 10} más`);
    console.log('\nDry-run completado. Nada modificado.');
    return;
  }

  let migrated = 0;
  const failures = [];
  const migratedPaths = [];

  for (const [index, obj] of objects.entries()) {
    const ext = extensionOf(obj.objectPath);
    const destination = `${obj.chatId}/${randomUUID()}${ext}`;

    try {
      const { data: blob, error: downloadError } = await supabase.storage
        .from(PUBLIC_BUCKET)
        .download(obj.objectPath);
      if (downloadError || !blob) throw downloadError || new Error('descarga vacía');

      const buffer = Buffer.from(await blob.arrayBuffer());
      const contentType = blob.type || mimeFromPath(obj.objectPath);

      const { error: uploadError } = await supabase.storage
        .from(PRIVATE_BUCKET)
        .upload(destination, buffer, { contentType, upsert: false });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage
        .from(PRIVATE_BUCKET)
        .getPublicUrl(destination);
      const newUrl = publicData.publicUrl;

      const { error: updateError } = await supabase
        .from('messages')
        .update({ attachment_url: newUrl })
        .in('id', obj.messageIds);
      if (updateError) throw updateError;

      migrated += 1;
      migratedPaths.push(obj.objectPath);
      if ((index + 1) % 20 === 0 || index + 1 === objects.length) {
        console.log(`Progreso: ${index + 1}/${objects.length}`);
      }
    } catch (err) {
      failures.push({ path: obj.objectPath, error: err.message });
      console.error(`FALLO ${obj.objectPath}: ${err.message}`);
    }
  }

  console.log(`\nMigrados: ${migrated}/${objects.length}`);
  console.log(`Fallos: ${failures.length}`);
  if (failures.length) {
    for (const f of failures.slice(0, 20)) console.error(`  - ${f.path}: ${f.error}`);
    process.exitCode = 1;
  }

  if (DELETE_ORIGINALS) {
    console.log('\nBorrando originales sin referencias...');
    let deleted = 0;
    for (const objectPath of migratedPaths) {
      try {
        const refs = await countRemainingRefs(objectPath);
        if (refs > 0) {
          console.log(`Conservado ${objectPath}: aún tiene ${refs} referencia/s`);
          continue;
        }
        const { error } = await supabase.storage.from(PUBLIC_BUCKET).remove([objectPath]);
        if (error) throw error;
        deleted += 1;
      } catch (err) {
        console.error(`No se pudo borrar ${objectPath}: ${err.message}`);
        process.exitCode = 1;
      }
    }
    console.log(`Originales borrados: ${deleted}`);
  }

  console.log('\nSiguiente paso recomendado: ejecutar sql/07_chat_images_policies.sql');
}

main().catch((err) => {
  console.error('ERROR FATAL:', err.message);
  process.exit(1);
});
