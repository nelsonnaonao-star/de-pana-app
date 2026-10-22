// Migración de media de conversaciones chat-images -> chat-media.
//
// Por defecto NO escribe nada (dry-run). Para copiar y actualizar referencias:
//   node server/scripts/migrate-chat-media.mjs --apply
//
// El borrado de los objetos públicos de origen es un paso SEPARADO y destructivo:
//   node server/scripts/migrate-chat-media.mjs --apply --delete-source --yes-delete
//
// Nunca borra stickers ni objetos sin referencia. Nunca sobrescribe un destino.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  IMAGE_BUCKET,
  PRIVATE_BUCKET,
  MESSAGE_MEDIA_FIELDS,
  migrationObjectPath,
  canonicalUrlFrom,
  shouldMigrateMessageRef,
} from '../src/lib/chatMediaMigration.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const args = new Set(process.argv.slice(2));
const APPLY = args.has('--apply');
const DELETE_SOURCE = args.has('--delete-source');
const CONFIRM_DELETE = args.has('--yes-delete');
const PAGE = 500;

if (DELETE_SOURCE && !APPLY) {
  console.error('--delete-source requiere --apply');
  process.exit(1);
}
if (DELETE_SOURCE && !CONFIRM_DELETE) {
  console.error('El borrado de origen requiere además --yes-delete');
  process.exit(1);
}

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, serviceKey);
const HOST = new URL(supabaseUrl).hostname;

const NON_MESSAGE_SOURCES = [
  { table: 'profiles', columns: ['avatar', 'avatar_url'], filter: null },
  { table: 'chats', columns: ['avatar'], filter: null },
  { table: 'business_flyers', columns: ['flyer_url'], filter: null },
  { table: 'broadcast_channels', columns: ['avatar_url'], filter: null },
];

// `stories` no se puede recorrer completo en este proyecto (statement timeout
// al leer image_url). Para el borrado se consulta SÓLO por las URLs candidatas.
async function findStoryUrls(urls) {
  const found = new Set();
  const errors = [];
  for (const urlToCheck of urls) {
    for (const column of ['image_url', 'video_url']) {
      const { data, error } = await supabase
        .from('stories')
        .select('id')
        .eq(column, urlToCheck)
        .limit(1);
      if (error) {
        errors.push(`${column}: ${error.message}`);
        break;
      }
      if (data && data.length > 0) found.add(urlToCheck);
    }
  }
  return { found, errors };
}

function classifyRaw(raw) {
  if (typeof raw !== 'string') return 'no-string';
  if (/^(data:|blob:)/i.test(raw)) return 'data/blob';
  if (!/^https?:\/\//i.test(raw)) return 'no-http';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return 'url-invalida';
  }
  if (parsed.hostname !== HOST) return `host-ajeno:${parsed.hostname}`;
  if (!parsed.pathname.includes(`/object/public/${IMAGE_BUCKET}/`) && !parsed.pathname.includes(`/object/public/${PRIVATE_BUCKET}/`)) {
    return 'host-propio-otro-path';
  }
  return 'no-clasificada';
}

function refFromUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.hostname !== HOST) return null;
  for (const bucket of [IMAGE_BUCKET, PRIVATE_BUCKET]) {
    const marker = `/object/public/${bucket}/`;
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) continue;
    try {
      return { bucket, path: decodeURIComponent(parsed.pathname.slice(idx + marker.length)) };
    } catch {
      return null;
    }
  }
  return null;
}

async function fetchMessages() {
  const rows = [];
  let from = 0;
  for (;;) {
    const query = supabase
      .from('messages')
      .select(`id, chat_id, type, is_deleted, ${MESSAGE_MEDIA_FIELDS.join(', ')}`)
      .or(MESSAGE_MEDIA_FIELDS.map((f) => `${f}.not.is.null`).join(','))
      .range(from, from + PAGE - 1);
    const { data, error } = await query;
    if (error) throw new Error(`messages: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

async function fetchNonMessageRefs() {
  const refs = [];
  const errors = [];
  for (const { table, columns, filter } of NON_MESSAGE_SOURCES) {
    let from = 0;
    for (;;) {
      let query = supabase.from(table).select(columns.join(',')).range(from, from + PAGE - 1);
      if (filter) query = query.or(filter);
      const { data, error } = await query;
      if (error) {
        errors.push(`${table}: ${error.message}`);
        break;
      }
      for (const row of data || []) {
        for (const column of columns) {
          const ref = refFromUrl(row[column]);
          if (ref) refs.push(ref);
        }
      }
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  return { refs, errors };
}

function keyOf(ref) {
  return `${ref.bucket}\u0000${ref.path}`;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function download(bucket, objectPath) {
  const { data, error } = await supabase.storage.from(bucket).download(objectPath);
  if (error || !data) return { error: error?.message || 'sin datos' };
  const buffer = Buffer.from(await data.arrayBuffer());
  return { buffer, contentType: data.type || 'application/octet-stream', size: buffer.length };
}

async function verifyDestination(chatId, sourcePath, sourceBuffer) {
  const objectPath = migrationObjectPath(chatId, sourcePath);
  let dest = await download(PRIVATE_BUCKET, objectPath);
  let copied = false;

  if (dest.error) {
    const source = await download(IMAGE_BUCKET, sourcePath);
    if (source.error) return { error: `origen: ${source.error}` };
    if (sha256(source.buffer) !== sha256(sourceBuffer)) {
      return { error: 'el origen cambió entre lecturas' };
    }
    const upload = await supabase.storage.from(PRIVATE_BUCKET).upload(objectPath, source.buffer, {
      contentType: source.contentType,
      upsert: false,
    });
    if (upload.error) return { error: `upload: ${upload.error.message}` };
    copied = true;
    dest = await download(PRIVATE_BUCKET, objectPath);
    if (dest.error) return { error: `verificación: ${dest.error}` };
  }

  if (dest.size !== sourceBuffer.length || sha256(dest.buffer) !== sha256(sourceBuffer)) {
    return { error: 'destino no coincide con el origen' };
  }
  return { objectPath, copied };
}

function summarize(entries, extra = {}) {
  const byField = {};
  const byType = {};
  const byFolder = {};
  const objects = new Set();
  for (const e of entries) {
    byField[e.field] = (byField[e.field] || 0) + 1;
    byType[e.type] = (byType[e.type] || 0) + 1;
    const folder = e.ref.path.includes('/') ? e.ref.path.split('/')[0] : '(root)';
    byFolder[folder] = (byFolder[folder] || 0) + 1;
    objects.add(e.ref.path);
  }
  return {
    messages: new Set(entries.map((e) => e.messageId)).size,
    refs: entries.length,
    uniqueObjects: objects.size,
    byField,
    byType,
    byFolder,
    ...extra,
  };
}

async function main() {
  const bucket = await supabase.storage.getBucket(PRIVATE_BUCKET);
  if (bucket.error) throw new Error(`chat-media: ${bucket.error.message}`);
  if (bucket.data.public !== false) {
    throw new Error('chat-media no es privado; se aborta para no publicar copias');
  }

  const rows = await fetchMessages();
  const plan = [];
  let stickerRefs = 0;
  let alreadyPrivate = 0;
  let unparsed = 0;
  const unparsedReasons = {};
  const unparsedExamples = [];

  for (const row of rows) {
    for (const field of MESSAGE_MEDIA_FIELDS) {
      const raw = row[field];
      if (!raw) continue;
      const ref = refFromUrl(raw);
      if (!ref) {
        unparsed += 1;
        const reason = classifyRaw(raw);
        unparsedReasons[reason] = (unparsedReasons[reason] || 0) + 1;
        if (unparsedExamples.length < 8) {
          const head = /^(data:|blob:)/i.test(raw) ? raw.slice(0, 20) : raw.slice(0, 100);
          unparsedExamples.push({ messageId: row.id, type: row.type, field, reason, valueHead: head });
        }
        continue;
      }
      if (ref.bucket === PRIVATE_BUCKET) {
        alreadyPrivate += 1;
        continue;
      }
      if (!shouldMigrateMessageRef(ref, row.type)) {
        stickerRefs += 1;
        continue;
      }
      plan.push({
        messageId: row.id,
        chatId: row.chat_id,
        type: row.type,
        isDeleted: row.is_deleted,
        field,
        url: raw,
        ref,
      });
    }
  }

  const baseSummary = summarize(plan, {
    mode: APPLY ? 'apply' : 'dry-run',
    deleteSource: DELETE_SOURCE,
    privateBucketPublic: bucket.data.public,
    messagesScanned: rows.length,
    stickerRefsSkipped: stickerRefs,
    alreadyPrivateRefs: alreadyPrivate,
    unparsedRefs: unparsed,
    unparsedReasons,
    unparsedExamples,
  });

  if (!APPLY) {
    console.log(JSON.stringify(baseSummary, null, 2));
    return;
  }

  const byMessage = new Map();
  for (const entry of plan) {
    if (!byMessage.has(entry.messageId)) byMessage.set(entry.messageId, []);
    byMessage.get(entry.messageId).push(entry);
  }

  const byChat = new Map();
  for (const entry of plan) byChat.set(entry.chatId, true);
  for (const chatId of byChat.keys()) {
    const { data, error } = await supabase.from('chats').select('id').eq('id', chatId).maybeSingle();
    if (error) throw new Error(`chats: ${error.message}`);
    if (!data) throw new Error(`chat inexistente: ${chatId}`);
  }

  const report = {
    ...baseSummary,
    messagesUpdated: 0,
    objectsCopied: 0,
    objectsAlreadyPresent: 0,
    objectsVerified: 0,
    failures: [],
    updateVerificationFailures: [],
    migratedSources: [],
    deletedSources: [],
    deleteSkipped: [],
  };

  for (const [messageId, entries] of byMessage) {
    const chatId = entries[0].chatId;
    const payload = {};
    const changed = [];

    try {
      for (const entry of entries) {
        const source = await download(IMAGE_BUCKET, entry.ref.path);
        if (source.error) throw new Error(`origen ${entry.ref.path}: ${source.error}`);
        const verified = await verifyDestination(chatId, entry.ref.path, source.buffer);
        if (verified.error) throw new Error(`destino ${entry.ref.path}: ${verified.error}`);
        report.objectsVerified += 1;
        if (verified.copied) report.objectsCopied += 1;
        else report.objectsAlreadyPresent += 1;
        const newUrl = canonicalUrlFrom(entry.url, PRIVATE_BUCKET, verified.objectPath);
        payload[entry.field] = newUrl;
        changed.push({ field: entry.field, oldUrl: entry.url, newUrl, sourcePath: entry.ref.path });
      }

      let update = supabase.from('messages').update(payload).eq('id', messageId);
      for (const c of changed) update = update.eq(c.field, c.oldUrl);
      const { data, error } = await update.select('id');
      if (error) throw new Error(`update: ${error.message}`);
      if (!data || data.length === 0) throw new Error('update sin filas (referencia cambiada por otro proceso)');

      const after = await supabase
        .from('messages')
        .select(MESSAGE_MEDIA_FIELDS.join(', '))
        .eq('id', messageId)
        .maybeSingle();
      if (after.error || !after.data) throw new Error(`verificación de fila: ${after.error?.message || 'no encontrada'}`);
      for (const c of changed) {
        if (after.data[c.field] !== c.newUrl) {
          report.updateVerificationFailures.push({ messageId, field: c.field });
          throw new Error(`fila no conserva ${c.field}`);
        }
      }

      report.messagesUpdated += 1;
      for (const c of changed) {
        report.migratedSources.push({ chatId, sourcePath: c.sourcePath, oldUrl: c.oldUrl });
      }
    } catch (e) {
      report.failures.push({ messageId, error: e.message });
    }
  }

  if (DELETE_SOURCE) {
    const remainingMessages = await fetchMessages();
    const messageRefs = new Set();
    for (const row of remainingMessages) {
      for (const field of MESSAGE_MEDIA_FIELDS) {
        const ref = refFromUrl(row[field]);
        if (ref) messageRefs.add(keyOf(ref));
      }
    }
    const nonMessage = await fetchNonMessageRefs();
    const nonMessageRefs = new Set(nonMessage.refs.map(keyOf));
    const sourceUrls = [...new Set(report.migratedSources.map((s) => s.oldUrl))];
    const stories = await findStoryUrls(sourceUrls);

    if (nonMessage.errors.length > 0 || stories.errors.length > 0) {
      report.deleteSkipped.push({
        reason: 'no se pudo verificar referencias no-mensaje',
        errors: [...nonMessage.errors, ...stories.errors.slice(0, 5)],
      });
    } else {
      const sources = new Map();
      const sourceUrlsByKey = new Map();
      for (const s of report.migratedSources) {
        const ref = refFromUrl(s.oldUrl);
        if (!ref) continue;
        const key = keyOf(ref);
        sources.set(key, ref);
        sourceUrlsByKey.set(key, s.oldUrl);
      }
      for (const [key, ref] of sources) {
        if (stories.found.has(sourceUrlsByKey.get(key))) {
          report.deleteSkipped.push({ path: ref.path, reason: 'referenciado por una historia' });
          continue;
        }
        if (messageRefs.has(key)) {
          report.deleteSkipped.push({ path: ref.path, reason: 'sigue referenciado por un mensaje' });
          continue;
        }
        if (nonMessageRefs.has(key)) {
          report.deleteSkipped.push({ path: ref.path, reason: 'referenciado fuera de messages' });
          continue;
        }
        const { error } = await supabase.storage.from(IMAGE_BUCKET).remove([ref.path]);
        if (error) {
          report.deleteSkipped.push({ path: ref.path, reason: `remove: ${error.message}` });
          continue;
        }
        const still = await download(IMAGE_BUCKET, ref.path);
        if (!still.error) {
          report.deleteSkipped.push({ path: ref.path, reason: 'el origen sigue accesible tras remove' });
          continue;
        }
        report.deletedSources.push(ref.path);
      }
    }
  }

  const afterRows = await fetchMessages();
  let remaining = 0;
  for (const row of afterRows) {
    for (const field of MESSAGE_MEDIA_FIELDS) {
      const ref = refFromUrl(row[field]);
      if (ref && ref.bucket === IMAGE_BUCKET && shouldMigrateMessageRef(ref, row.type)) remaining += 1;
    }
  }
  report.remainingChatImagesConversationRefs = remaining;

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportDir = path.resolve(__dirname, '..', 'uploads', '.migration-reports');
  const reportPath = path.join(reportDir, `chat-media-${stamp}.json`);
  await fs.mkdir(reportDir, { recursive: true });
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  report.reportPath = reportPath;

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('MIGRATION ERROR:', err.message);
  process.exit(1);
});
