// Utilidades PURAS (sin dependencias ni efectos) para clasificar y normalizar
// referencias de Storage de Supabase en el cliente.
//
// Es el espejo cliente de `server/src/lib/storageRefs.js`. La clasificación es
// SIEMPRE por el BUCKET explícito en la URL, nunca por el nombre de la carpeta:
//   chat-images → PÚBLICO  (avatares, historias, flyers, stickers, media legado)
//   chat-media  → PRIVADO  (media de conversaciones; se sirve con URL firmada)
//
// No depende de `import.meta.env`, red ni Supabase → verificable con tests puros.

export const SUPABASE_HOST = "akgsylutbpgolurkcavh.supabase.co";
export const PUBLIC_BUCKET = "chat-images";
export const PRIVATE_BUCKET = "chat-media";
export const KNOWN_BUCKETS = [PUBLIC_BUCKET, PRIVATE_BUCKET] as const;

const OBJECT_MARKER = "/object/public/";
const SIGN_MARKER = "/object/sign/";

export interface StorageRef {
  bucket: string;
  path: string;
}

function isHttpUrl(url: unknown): url is string {
  return (
    typeof url === "string" &&
    (url.startsWith("http://") || url.startsWith("https://"))
  );
}

// Extrae { bucket, path } de una URL con el marcador dado (`/object/public/` o
// `/object/sign/`). Sólo reconoce el host del proyecto y los buckets conocidos.
// Rechaza (null) host ajeno, bucket desconocido, path vacío, con `..` o con `/`
// inicial (traversal). El path se decodifica para validar los caracteres reales.
function parseMarker(url: unknown, marker: string): StorageRef | null {
  if (!isHttpUrl(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.hostname !== SUPABASE_HOST) return null;

  for (const bucket of KNOWN_BUCKETS) {
    const full = `${marker}${bucket}/`;
    const idx = parsed.pathname.indexOf(full);
    if (idx === -1) continue;

    let storagePath: string;
    try {
      storagePath = decodeURIComponent(parsed.pathname.slice(idx + full.length));
    } catch {
      return null;
    }
    if (!storagePath || storagePath.includes("..") || storagePath.startsWith("/")) {
      return null;
    }
    return { bucket, path: storagePath };
  }
  return null;
}

// Referencia canónica almacenada: `<base>/storage/v1/object/public/<bucket>/<path>`.
export function parseStorageRef(url: unknown): StorageRef | null {
  return parseMarker(url, OBJECT_MARKER);
}

// Referencia firmada (temporal, con token en la query):
// `<base>/storage/v1/object/sign/<bucket>/<path>?token=…`.
export function parseSignedStorageRef(url: unknown): StorageRef | null {
  return parseMarker(url, SIGN_MARKER);
}

// ¿Es una referencia propia (de un bucket conocido) que debe servirse firmada?
// Cubre tanto la forma canónica como la firmada. Externos/blob/data → false.
export function isSignableStorageUrl(url: unknown): boolean {
  return parseStorageRef(url) !== null || parseSignedStorageRef(url) !== null;
}

// ¿Es ya una URL firmada de un bucket propio? (para no re-firmar/persistir).
export function isStorageSignedUrl(url: unknown): boolean {
  return parseSignedStorageRef(url) !== null;
}

// Compatibilidad: detección estricta del bucket PÚBLICO `chat-images`.
export function isChatImagesUrl(url: unknown): boolean {
  const ref = parseStorageRef(url);
  return !!ref && ref.bucket === PUBLIC_BUCKET;
}

export function isChatImagesSignedUrl(url: unknown): boolean {
  const ref = parseSignedStorageRef(url);
  return !!ref && ref.bucket === PUBLIC_BUCKET;
}

// Identidad ESTABLE de un objeto propio: la forma canónica (`/object/public/`)
// sin query. Una URL firmada normaliza al MISMO valor que su canónica, de modo
// que las cachés no se invalidan al expirar la firma.
//
// - firmada de bucket propio → se reescribe al marcador público (identidad).
// - canónica de bucket propio → intacta (sin query).
// - cualquier otra (externo, blob, data, otro bucket) → intacta.
//
// Idempotente. NO usar URL.pathname (re-codifica y rompería la identidad
// byte-a-byte con lo almacenado): se opera sobre el string tal cual.
export function storageBaseUrl(url: string | null | undefined): string | null | undefined {
  if (!url || !isHttpUrl(url)) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname !== SUPABASE_HOST) return url;

  const q = url.indexOf("?");
  const noQuery = q === -1 ? url : url.slice(0, q);
  for (const bucket of KNOWN_BUCKETS) {
    const signFull = `${SIGN_MARKER}${bucket}/`;
    const pubFull = `${OBJECT_MARKER}${bucket}/`;
    if (noQuery.includes(signFull)) return noQuery.replace(signFull, pubFull);
    if (noQuery.includes(pubFull)) return noQuery;
  }
  return url;
}
