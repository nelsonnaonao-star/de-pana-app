// Utilidades PURAS para interpretar referencias de Storage de Supabase.
//
// Clasificación FIABLE por BUCKET (explícito en la URL guardada), NUNCA por el
// nombre de la carpeta. Buckets conocidos:
//   chat-images → PÚBLICO  (avatares, historias, flyers, stickers, media legado)
//   chat-media  → PRIVADO  (media de conversaciones; se sirve con URL firmada)
//
// La existencia y la visibilidad de cada bucket se configuran en Supabase. Aquí
// sólo se interpreta lo que ya viene en la URL; no se crea ni se cambia nada.
//
// Sin dependencias externas → verificable con `node --test` sin red.

// Host de Storage: se deriva de la MISMA configuración con la que el backend
// crea su cliente de Supabase (`VITE_SUPABASE_URL`, ver db.js:3). El ancla de
// confianza coincide así con el proyecto real del backend. Si la variable falta,
// está vacía o es inválida, la configuración FALLA de forma EXPLÍCITA: no se
// asume ningún proyecto predeterminado. Las comprobaciones de host siguen siendo
// igualdad estricta de hostname.
export function resolveSupabaseHost(rawUrl) {
  if (typeof rawUrl !== 'string' || rawUrl.trim() === '') {
    throw new Error('Configuración inválida: VITE_SUPABASE_URL no está definida');
  }
  let host;
  try {
    host = new URL(rawUrl).hostname;
  } catch {
    throw new Error('Configuración inválida: VITE_SUPABASE_URL no es una URL válida');
  }
  if (!host) {
    throw new Error('Configuración inválida: VITE_SUPABASE_URL no contiene host');
  }
  return host;
}

export const SUPABASE_HOST = resolveSupabaseHost(
  typeof process !== 'undefined' && process.env ? process.env.VITE_SUPABASE_URL : undefined
);
export const PUBLIC_BUCKET = 'chat-images';
export const PRIVATE_BUCKET = 'chat-media';
export const KNOWN_BUCKETS = [PUBLIC_BUCKET, PRIVATE_BUCKET];

const OBJECT_MARKER = '/object/public/';

function isHttpUrl(url) {
  return (
    typeof url === 'string' &&
    (url.startsWith('http://') || url.startsWith('https://'))
  );
}

export function isPrivateBucket(bucket) {
  return bucket === PRIVATE_BUCKET;
}

// Comprueba que una referencia PRIVADA (bucket `chat-media`) esté vinculada
// EXACTAMENTE al chat indicado por el primer segmento de su ruta validada
// (`<chat_uuid>/<uuid>.<ext>`). No aplica a buckets públicos: devuelve false
// para refs nulas, buckets no privados, rutas sin separador o cuyo primer
// segmento no coincide con el chat. La comparación es sobre `ref.path` ya
// normalizado por `extractStorageRef` (sin traversal), nunca sobre la URL
// cruda del cliente.
export function isPrivateRefForChat(ref, chatId) {
  if (!ref || ref.bucket !== PRIVATE_BUCKET) return false;
  if (typeof chatId !== 'string' || chatId.length === 0) return false;
  const separator = ref.path.indexOf('/');
  if (separator === -1) return false;
  return ref.path.slice(0, separator) === chatId;
}

// ¿Puede usarse esta referencia de media en un mensaje del chat indicado?
// - no-http / data: / blob: / ids internos → sin restricción (contrato previo).
// - bucket público `chat-images` → sin restricción.
// - bucket privado `chat-media` → la ruta debe pertenecer exactamente al chat.
// - URL http de host ajeno, bucket desconocido o con traversal → false.
export function mediaRefAllowedForChat(rawUrl, chatId) {
  if (!rawUrl || typeof rawUrl !== 'string') return true;
  if (!isHttpUrl(rawUrl)) return true;
  const ref = extractStorageRef(rawUrl);
  if (!ref) return false;
  if (!isPrivateBucket(ref.bucket)) return true;
  return isPrivateRefForChat(ref, chatId);
}

// Devuelve { bucket, path } SOLO si la URL es http(s), del host del proyecto y
// apunta a `/object/public/<bucket-conocido>/<path>` sin traversal. En cualquier
// otro caso (host ajeno, otro bucket del proyecto, /object/sign/, path con `..`,
// no-http) devuelve null.
export function extractStorageRef(url) {
  if (!isHttpUrl(url)) return null;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== SUPABASE_HOST) return null;

  for (const bucket of KNOWN_BUCKETS) {
    const marker = `${OBJECT_MARKER}${bucket}/`;
    const idx = parsed.pathname.indexOf(marker);
    if (idx === -1) continue;

    let storagePath;
    try {
      storagePath = decodeURIComponent(parsed.pathname.slice(idx + marker.length));
    } catch {
      return null;
    }
    if (!storagePath || storagePath.includes('..') || storagePath.startsWith('/')) {
      return null;
    }
    return { bucket, path: storagePath };
  }
  return null;
}

// Retro-compatibilidad: devuelve el path SÓLO para el bucket PÚBLICO.
// (El bucket privado debe resolverse con extractStorageRef para no firmar con
// el bucket equivocado.)
export function extractPath(url) {
  const ref = extractStorageRef(url);
  return ref && ref.bucket === PUBLIC_BUCKET ? ref.path : null;
}

// Validación de referencias de media en mensajes. Mantiene el contrato previo
// de `extractPath` usado por las rutas de mensajería: acepta valores no-http
// (data:, blob:, ids/rutas internas) y RECHAZA URLs http de hosts ajenos.
// Extiende la aceptación a los buckets conocidos del proyecto (público y
// privado), de modo que un mensaje puede referenciar chat-media.
export function isAllowedMediaRef(url) {
  if (!url || typeof url !== 'string') return true;
  if (!isHttpUrl(url)) return true; // data:, blob:, ids, rutas relativas

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.hostname !== SUPABASE_HOST) return false; // host externo: rechazado
  return extractStorageRef(url) !== null;
}

// Variante permisiva histórica (permite hosts externos). Se conserva por
// compatibilidad con imports existentes; no la usa la mensajería.
export function validateMediaReference(url) {
  if (!url || typeof url !== 'string') return true;
  if (url.startsWith('blob:') || url.startsWith('data:')) return true;
  if (!isHttpUrl(url)) return true;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.hostname !== SUPABASE_HOST) return true;
  return extractStorageRef(url) !== null;
}
