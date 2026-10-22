// Auditoría READ-ONLY de la exposición de media de conversaciones.
// No escribe en Storage ni en la base de datos. Sirve para dimensionar la
// migración antes de autorizar cualquier cambio remoto.
//
// Uso: node server/scripts/audit-chat-media.mjs
// Requiere server/.env con VITE_SUPABASE_URL y SUPABASE_SERVICE_KEY.

import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const url = process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) {
  console.error('Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(url, key);
const HOST = new URL(url).hostname;
const BUCKETS = ['chat-images', 'chat-media'];
const MEDIA_FIELDS = ['image_url', 'audio_url', 'video_url', 'file_url', 'sticker_url', 'gif_url'];
const MESSAGE_FIELDS = ['image_url', 'audio_url', 'video_url', 'file_url'];
const PAGE = 1000;

function refFromUrl(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.hostname !== HOST) return null;
  for (const bucket of BUCKETS) {
    for (const marker of [`/object/public/${bucket}/`, `/object/sign/${bucket}/`]) {
      const idx = parsed.pathname.indexOf(marker);
      if (idx === -1) continue;
      try {
        return {
          bucket,
          path: decodeURIComponent(parsed.pathname.slice(idx + marker.length)),
          form: marker.includes('/public/') ? 'public' : 'sign',
        };
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function listAll(bucket, prefix = '') {
  const out = [];
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: PAGE,
      offset,
      sortBy: { column: 'name', order: 'asc' },
    });
    if (error) throw new Error(`${bucket}/${prefix}: ${error.message}`);
    if (!data || data.length === 0) break;
    for (const entry of data) {
      const child = prefix ? `${prefix}/${entry.name}` : entry.name;
      const isFolder = entry.id === null && !entry.metadata;
      if (isFolder) out.push(...(await listAll(bucket, child)));
      else out.push({ ...entry, path: child });
    }
    if (data.length < PAGE) break;
    offset += data.length;
  }
  return out;
}

async function allMessages() {
  const rows = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('messages')
      .select('id, chat_id, type, created_at, is_deleted, image_url, audio_url, video_url, file_url, sticker_url, gif_url')
      .or([...MEDIA_FIELDS, 'sticker_url', 'gif_url'].map((f) => `${f}.not.is.null`).join(','))
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`messages: ${error.message}`);
    rows.push(...(data || []));
    if (!data || data.length < PAGE) break;
    from += PAGE;
  }
  return rows;
}

function countBy(items, fn) {
  const map = {};
  for (const item of items) {
    const k = fn(item);
    map[k] = (map[k] || 0) + 1;
  }
  return map;
}

// Referencias de Storage fuera de `messages` (avatares, historias, flyers,
// canales). Se consultan de forma tolerante: si una tabla/columna no existe en
// este proyecto se ignora y queda registrado.
const NON_MESSAGE_SOURCES = [
  { table: 'profiles', columns: ['avatar', 'avatar_url'] },
  { table: 'chats', columns: ['avatar'] },
  { table: 'business_flyers', columns: ['flyer_url'] },
  { table: 'broadcast_channels', columns: ['avatar_url'] },
];

async function nonMessageRefs() {
  const refs = [];
  const errors = [];
  for (const { table, columns } of NON_MESSAGE_SOURCES) {
    let from = 0;
    for (;;) {
      const { data, error } = await supabase
        .from(table)
        .select(columns.join(','))
        .range(from, from + PAGE - 1);
      if (error) {
        errors.push(`${table}: ${error.message}`);
        break;
      }
      for (const row of data || []) {
        for (const column of columns) {
          const ref = refFromUrl(row[column]);
          if (ref) refs.push({ ...ref, source: `${table}.${column}` });
        }
      }
      if (!data || data.length < PAGE) break;
      from += PAGE;
    }
  }
  return { refs, errors };
}

// `stories` no se puede recorrer completo (timeout al leer image_url). Se
// comprueban SÓLO los objetos del bucket que viven bajo `stories/`.
async function storyRefsForPaths(paths) {
  const refs = [];
  const errors = [];
  for (const objectPath of paths) {
    const publicUrl = `${url}/storage/v1/object/public/chat-images/${objectPath}`;
    for (const column of ['image_url', 'video_url']) {
      const { data, error } = await supabase
        .from('stories')
        .select('id')
        .eq(column, publicUrl)
        .limit(1);
      if (error) {
        errors.push(`stories.${column}: ${error.message}`);
        break;
      }
      if (data && data.length > 0) {
        refs.push({ bucket: 'chat-images', path: objectPath, source: `stories.${column}` });
      }
    }
  }
  return { refs, errors };
}

async function isPubliclyReadable(urlToCheck) {
  try {
    const res = await fetch(urlToCheck, { method: 'GET', headers: { Range: 'bytes=0-0' } });
    return { status: res.status, ok: res.ok, contentType: res.headers.get('content-type') };
  } catch (e) {
    return { status: 0, ok: false, error: e.message };
  }
}

async function main() {
  const objects = {};
  for (const bucket of BUCKETS) {
    objects[bucket] = await listAll(bucket);
  }

  const messages = await allMessages();
  const refs = [];
  for (const msg of messages) {
    for (const field of MEDIA_FIELDS) {
      const ref = refFromUrl(msg[field]);
      if (ref) refs.push({ ...ref, field, messageId: msg.id, chatId: msg.chat_id, type: msg.type, isDeleted: msg.is_deleted });
    }
  }

  const nonMsg = await nonMessageRefs();
  const storyPaths = objects['chat-images']
    .filter((o) => o.path.startsWith('stories/'))
    .map((o) => o.path);
  const stories = await storyRefsForPaths(storyPaths);
  nonMsg.refs.push(...stories.refs);
  nonMsg.errors.push(...stories.errors);

  const referenced = new Set(refs.map((r) => `${r.bucket}\u0000${r.path}`));
  const nonMessageReferenced = new Set(nonMsg.refs.map((r) => `${r.bucket}\u0000${r.path}`));
  const objectKeys = new Set();
  for (const bucket of BUCKETS) {
    for (const o of objects[bucket]) objectKeys.add(`${bucket}\u0000${o.path}`);
  }

  const missingRefs = refs.filter((r) => !objectKeys.has(`${r.bucket}\u0000${r.path}`));

  const chatImagesObjects = objects['chat-images'];
  const chatImagesReferenced = chatImagesObjects.filter((o) => referenced.has(`chat-images\u0000${o.path}`));
  const chatImagesUnreferenced = chatImagesObjects.filter((o) => !referenced.has(`chat-images\u0000${o.path}`));

  const stickerRefs = refs.filter((r) => r.bucket === 'chat-images' && r.path.split('/')[0] === 'sticker');
  const conversationRefs = refs.filter((r) => r.bucket === 'chat-images' && !(r.path.split('/')[0] === 'sticker'));
  const objectsByKey = new Map(chatImagesObjects.map((o) => [`chat-images\u0000${o.path}`, o]));
  const conversationObjects = [...new Set(conversationRefs.map((r) => `chat-images\u0000${r.path}`))]
    .map((k) => objectsByKey.get(k))
    .filter(Boolean);
  const totalBytes = conversationObjects.reduce((sum, o) => sum + Number(o.metadata?.size || 0), 0);

  const bucketMeta = {};
  for (const bucket of BUCKETS) {
    const { data, error } = await supabase.storage.getBucket(bucket);
    bucketMeta[bucket] = error ? { error: error.message } : { public: data.public, fileSizeLimit: data.file_size_limit, allowedMimeTypes: data.allowed_mime_types };
  }

  const privateSample = objects['chat-media'][0];
  let privatePublicProbe = null;
  if (privateSample) {
    privatePublicProbe = await isPubliclyReadable(`${url}/storage/v1/object/public/chat-media/${privateSample.path}`);
  }

  const extOf = (p) => (p.includes('.') ? p.split('.').pop().toLowerCase() : '(none)');

  const folderOf = (p) => (p.includes('/') ? p.split('/')[0] : '(root)');

  const report = {
    host: HOST,
    buckets: {
      'chat-images': {
        objects: chatImagesObjects.length,
        referencedByMessages: chatImagesReferenced.length,
        unreferencedByMessages: chatImagesUnreferenced.length,
        unreferencedFolders: countBy(chatImagesUnreferenced, (o) => folderOf(o.path)),
        referencedFolders: countBy(chatImagesReferenced, (o) => folderOf(o.path)),
      },
      'chat-media': {
        objects: objects['chat-media'].length,
        referencedByMessages: objects['chat-media'].filter((o) => referenced.has(`chat-media\u0000${o.path}`)).length,
        folders: countBy(objects['chat-media'], (o) => folderOf(o.path)),
      },
    },
    messagesScanned: messages.length,
    messageMediaRefs: refs.length,
    refsByBucket: countBy(refs, (r) => r.bucket),
    refsByField: countBy(refs, (r) => r.field),
    refsByMessageType: countBy(refs, (r) => r.type),
    refsByFolder: countBy(refs, (r) => `${r.bucket}/${folderOf(r.path)}`),
    refsForm: countBy(refs, (r) => r.form),
    refsByTypeAndFolder: countBy(refs, (r) => `${r.type} :: ${r.bucket}/${folderOf(r.path)}`),
    uniqueRefObjects: new Set(refs.map((r) => `${r.bucket}\u0000${r.path}`)).size,
    sharedRefObjects: [...refs.reduce((m, r) => {
      const k = `${r.bucket}\u0000${r.path}`;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(r);
      return m;
    }, new Map()).entries()].filter(([, list]) => list.length > 1).map(([k, list]) => ({
      ref: k.replace('\u0000', '/'),
      refs: list.length,
      chats: [...new Set(list.map((r) => r.chatId))].length,
      types: [...new Set(list.map((r) => r.type))],
      fields: [...new Set(list.map((r) => r.field))],
      deleted: list.filter((r) => r.isDeleted).length,
    })),
    conversationMediaRefs: conversationRefs.length,
    stickerRefs: stickerRefs.length,
    conversationUniqueObjects: conversationObjects.length,
    conversationTotalBytes: totalBytes,
    conversationExtensions: countBy(conversationObjects, (o) => extOf(o.path)),
    conversationContentTypes: countBy(conversationObjects, (o) => o.metadata?.mimetype || o.metadata?.contentType || '(unknown)'),
    conversationDeletedMessageRefs: conversationRefs.filter((r) => r.isDeleted).length,
    stickerDeletedMessageRefs: stickerRefs.filter((r) => r.isDeleted).length,
    bucketMeta,
    privateCanonicalPublicProbe: privatePublicProbe,
    deletedMessageRefs: refs.filter((r) => r.isDeleted).length,
    nonMessageRefs: nonMsg.refs.length,
    nonMessageRefsBySource: countBy(nonMsg.refs, (r) => r.source),
    nonMessageRefsByBucket: countBy(nonMsg.refs, (r) => r.bucket),
    nonMessageQueryErrors: nonMsg.errors,
    chatImagesUnreferencedByMessagesButUsedElsewhere: chatImagesUnreferenced.filter((o) => nonMessageReferenced.has(`chat-images\u0000${o.path}`)).length,
    chatImagesUnreferencedAndUnused: chatImagesUnreferenced.filter((o) => !nonMessageReferenced.has(`chat-images\u0000${o.path}`)).length,
    chatImagesUnreferencedAndUnusedByFolder: countBy(chatImagesUnreferenced.filter((o) => !nonMessageReferenced.has(`chat-images\u0000${o.path}`)), (o) => folderOf(o.path)),
    missingRefs: missingRefs.length,
    missingRefExamples: missingRefs.slice(0, 5).map((r) => ({ bucket: r.bucket, path: r.path, messageId: r.messageId, field: r.field })),
    unreferencedExamples: chatImagesUnreferenced.slice(0, 10).map((o) => o.path),
  };

  // Muestra REAL de exposición anónima del bucket público.
  const sample = chatImagesReferenced.slice(0, 3);
  report.anonymousReadSample = [];
  for (const o of sample) {
    const res = await isPubliclyReadable(o.publicUrl || `${url}/storage/v1/object/public/chat-images/${o.path}`);
    report.anonymousReadSample.push({ path: o.path, ...res });
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error('AUDIT ERROR:', err.message);
  process.exit(1);
});
