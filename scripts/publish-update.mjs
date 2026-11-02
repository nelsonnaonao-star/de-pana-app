#!/usr/bin/env node
/**
 * Publica una actualización de DE PANA (WEPA) en Supabase.
 *
 * Uso:
 *   node scripts/publish-update.mjs \
 *     --apk "DePana-v1.1.apk" \
 *     --version-code 2 \
 *     --version-name 1.1 \
 *     --notes "Correcciones y mejoras" \
 *     [--mandatory] [--min-supported-code 1] [--force]
 *
 * Variables de entorno (se leen de .env):
 *   VITE_SUPABASE_URL o SUPABASE_URL
 *   SUPABASE_SERVICE_KEY o SUPABASE_SERVICE_ROLE_KEY
 *
 * El script NO confía en los argumentos: extrae versionCode/versionName/package
 * del propio AndroidManifest.xml dentro del APK y aborta si no coinciden.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, ".env"), quiet: true });

const BUCKET = "app-updates";
const EXPECTED_PACKAGE = "com.redon.app";
const BUILD_GRADLE = path.join(ROOT, "android", "app", "build.gradle");

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = { mandatory: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--apk":
        out.apk = argv[++i];
        break;
      case "--version-code":
        out.versionCode = argv[++i];
        break;
      case "--version-name":
        out.versionName = argv[++i];
        break;
      case "--notes":
        out.notes = argv[++i];
        break;
      case "--min-supported-code":
        out.minSupportedCode = argv[++i];
        break;
      case "--mandatory":
        out.mandatory = true;
        break;
      case "--force":
        out.force = true;
        break;
      case "--check":
        out.check = true;
        break;
      case "--help":
      case "-h":
        out.help = true;
        break;
      default:
        throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return out;
}

function printHelp() {
  console.log(`
Publicar actualización de DE PANA en Supabase

  node scripts/publish-update.mjs --apk <ruta.apk> --version-code <n> [opciones]

Obligatorio:
  --apk <ruta>               Ruta al APK firmado.
  --version-code <n>         versionCode esperado (debe coincidir con el APK).

Opcionales:
  --version-name <texto>     versionName esperado (si no se pasa, se usa el del APK).
  --notes <texto>            Notas de la versión que verá el usuario.
  --mandatory                Fuerza la actualización (el usuario no puede omitir).
  --min-supported-code <n>   Versiones por debajo de este código quedan obligadas.
  --force                    Permite republicar un versionCode ya existente.
  --check                    Solo valida el APK (no sube nada a Supabase).
`);
}

// ---------------------------------------------------------------------------
// ZIP mínimo: extrae una entrada (AndroidManifest.xml) de un APK
// ---------------------------------------------------------------------------
function readCentralDirectory(zipBuffer) {
  let eocd = -1;
  const minOffset = Math.max(0, zipBuffer.length - 65557);
  for (let i = zipBuffer.length - 22; i >= minOffset; i--) {
    if (zipBuffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP inválido: no se encontró el End Of Central Directory.");

  const entryCount = zipBuffer.readUInt16LE(eocd + 10);
  let offset = zipBuffer.readUInt32LE(eocd + 16);
  const entries = [];

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > zipBuffer.length || zipBuffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("ZIP inválido: entrada de directorio central corrupta.");
    }
    const method = zipBuffer.readUInt16LE(offset + 10);
    const compressedSize = zipBuffer.readUInt32LE(offset + 20);
    const nameLength = zipBuffer.readUInt16LE(offset + 28);
    const extraLength = zipBuffer.readUInt16LE(offset + 30);
    const commentLength = zipBuffer.readUInt16LE(offset + 32);
    const localOffset = zipBuffer.readUInt32LE(offset + 42);
    const name = zipBuffer.toString("utf8", offset + 46, offset + 46 + nameLength);

    entries.push({ name, method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readZipEntry(zipBuffer, entryName) {
  const entry = readCentralDirectory(zipBuffer).find((item) => item.name === entryName);
  if (!entry) throw new Error(`ZIP: no se encontró ${entryName} dentro del APK.`);

  if (zipBuffer.readUInt32LE(entry.localOffset) !== 0x04034b50) {
    throw new Error("ZIP inválido: cabecera local corrupta.");
  }
  const localNameLength = zipBuffer.readUInt16LE(entry.localOffset + 26);
  const localExtraLength = zipBuffer.readUInt16LE(entry.localOffset + 28);
  const dataStart = entry.localOffset + 30 + localNameLength + localExtraLength;
  const data = zipBuffer.subarray(dataStart, dataStart + entry.compressedSize);

  if (entry.method === 0) return data;
  if (entry.method === 8) return zlib.inflateRawSync(data);
  throw new Error(`ZIP: método de compresión no soportado (${entry.method}).`);
}

/**
 * Comprueba que el APK tenga firma (v1 en META-INF o bloque de firma v2+).
 * No puede verificar que sea el mismo keystore del APK instalado, pero evita
 * publicar artefactos sin firmar por accidente.
 */
function assertApkSigned(zipBuffer) {
  const hasV2Plus = zipBuffer.includes(Buffer.from("APK Sig Block 42"));
  const hasV1 = readCentralDirectory(zipBuffer).some((entry) =>
    /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(entry.name),
  );
  if (!hasV1 && !hasV2Plus) {
    fail(
      "El APK no está firmado. Android rechazará la actualización. " +
        "Firma el release con el mismo keystore de la app instalada.",
    );
  }
}

// ---------------------------------------------------------------------------
// Parser mínimo de Android Binary XML (AXML)
// ---------------------------------------------------------------------------
function parseStringPool(buf, start) {
  const headerSize = buf.readUInt16LE(start + 2);
  const count = buf.readUInt32LE(start + 8);
  const flags = buf.readUInt32LE(start + 16);
  const stringsStart = buf.readUInt32LE(start + 20);
  const isUtf8 = (flags & 0x100) !== 0;
  const base = start + stringsStart;
  const strings = [];

  for (let i = 0; i < count; i++) {
    const offset = buf.readUInt32LE(start + headerSize + i * 4);
    let p = base + offset;

    if (isUtf8) {
      let length = buf[p++];
      if (length & 0x80) length = ((length & 0x7f) << 8) | buf[p++];
      strings.push(buf.toString("utf8", p, p + length));
    } else {
      let length = buf.readUInt16LE(p);
      p += 2;
      if (length & 0x8000) {
        length = ((length & 0x7fff) << 16) | buf.readUInt16LE(p);
        p += 2;
      }
      strings.push(buf.toString("utf16le", p, p + length * 2));
    }
  }

  return strings;
}

function parseManifestFromAxml(buf) {
  if (buf.length < 8 || buf.readUInt16LE(0) !== 0x0003) {
    throw new Error("AndroidManifest.xml no es un AXML válido.");
  }

  const totalSize = Math.min(buf.readUInt32LE(4), buf.length);
  let offset = buf.readUInt16LE(2);
  let strings = null;
  let resourceMap = [];

  while (offset + 8 <= totalSize) {
    const chunkType = buf.readUInt16LE(offset);
    const chunkHeaderSize = buf.readUInt16LE(offset + 2);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkSize < 8) break;

    if (chunkType === 0x0001) {
      strings = parseStringPool(buf, offset);
    } else if (chunkType === 0x0180) {
      const count = Math.floor((chunkSize - chunkHeaderSize) / 4);
      resourceMap = [];
      for (let i = 0; i < count; i++) {
        resourceMap.push(buf.readUInt32LE(offset + chunkHeaderSize + i * 4));
      }
    } else if (chunkType === 0x0102) {
      const nameIndex = buf.readUInt32LE(offset + 20);
      const elementName = strings ? strings[nameIndex] : null;

      if (elementName === "manifest") {
        const attrStart = buf.readUInt16LE(offset + 24);
        const attrSize = buf.readUInt16LE(offset + 26);
        const attrCount = buf.readUInt16LE(offset + 28);
        // attributeStart es relativo al inicio de attrExt (offset + 16).
        // headerSize también apunta al primer atributo; usamos el que exista.
        const attrBase =
          attrStart > 0 ? offset + 16 + attrStart : offset + chunkHeaderSize;

        const result = {};
        for (let i = 0; i < attrCount; i++) {
          const a = attrBase + i * attrSize;
          if (a + 20 > buf.length) break;
          const attrNameIndex = buf.readUInt32LE(a + 4);
          const rawValueIndex = buf.readUInt32LE(a + 8);
          const dataType = buf.readUInt8(a + 15);
          const data = buf.readUInt32LE(a + 16);
          const resId = resourceMap[i] || 0;
          const attrName = strings ? strings[attrNameIndex] : "";

          if (resId === 0x0101021b || attrName === "versionCode") {
            result.versionCode = data >>> 0;
          } else if (resId === 0x0101021c || attrName === "versionName") {
            result.versionName =
              rawValueIndex !== 0xffffffff && strings
                ? strings[rawValueIndex]
                : dataType === 0x03 && strings
                  ? strings[data]
                  : String(data);
          } else if (attrName === "package") {
            result.package =
              rawValueIndex !== 0xffffffff && strings
                ? strings[rawValueIndex]
                : dataType === 0x03 && strings
                  ? strings[data]
                  : String(data);
          }
        }
        return result;
      }
    }

    offset += chunkSize;
  }

  throw new Error("No se encontró el elemento <manifest> en el AXML.");
}

// ---------------------------------------------------------------------------
// Fallback: aapt2 dump badging (si el parser interno fallara)
// ---------------------------------------------------------------------------
function findAapt2() {
  const home = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (!home) return null;
  const buildTools = path.join(home, "build-tools");
  if (!fs.existsSync(buildTools)) return null;

  const exe = process.platform === "win32" ? "aapt2.exe" : "aapt2";
  const versions = fs
    .readdirSync(buildTools)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));

  for (const version of versions) {
    const candidate = path.join(buildTools, version, exe);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function readManifestWithAapt(apkPath) {
  const aapt2 = findAapt2();
  if (!aapt2) return null;

  try {
    const output = execFileSync(aapt2, ["dump", "badging", apkPath], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    const line = output.split(/\r?\n/).find((l) => l.startsWith("package:"));
    if (!line) return null;
    const versionCode = /versionCode='(\d+)'/.exec(line)?.[1];
    const versionName = /versionName='([^']*)'/.exec(line)?.[1];
    const pkg = /name='([^']*)'/.exec(line)?.[1];
    return {
      versionCode: versionCode ? Number(versionCode) : undefined,
      versionName,
      package: pkg,
    };
  } catch {
    return null;
  }
}

function readApkManifest(apkPath) {
  const zipBuffer = fs.readFileSync(apkPath);
  try {
    const axml = readZipEntry(zipBuffer, "AndroidManifest.xml");
    return parseManifestFromAxml(axml);
  } catch (error) {
    const fallback = readManifestWithAapt(apkPath);
    if (fallback) {
      console.warn(
        `[aviso] Parser interno falló (${error.message}); usando aapt2 como respaldo.`,
      );
      return fallback;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Validaciones
// ---------------------------------------------------------------------------
function readGradleVersion() {
  const gradle = fs.readFileSync(BUILD_GRADLE, "utf8");
  const versionCode = /versionCode\s+(\d+)/.exec(gradle)?.[1];
  const versionName = /versionName\s+"([^"]+)"/.exec(gradle)?.[1];
  return {
    versionCode: versionCode ? Number(versionCode) : null,
    versionName: versionName ?? null,
  };
}

function fail(message) {
  console.error(`\n✖ ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!args.apk) fail("Falta --apk <ruta.apk>.");
  if (!args.versionCode || !/^\d+$/.test(String(args.versionCode))) {
    fail("Falta --version-code <n> (entero positivo).");
  }

  const apkPath = path.resolve(ROOT, args.apk);
  if (!fs.existsSync(apkPath)) fail(`No existe el APK: ${apkPath}`);

  const versionCode = Number(args.versionCode);
  const manifest = readApkManifest(apkPath);

  console.log(`\nAPK:          ${apkPath}`);
  console.log(`Package:      ${manifest.package ?? "(desconocido)"}`);
  console.log(`versionCode:  ${manifest.versionCode ?? "(desconocido)"}`);
  console.log(`versionName:  ${manifest.versionName ?? "(desconocido)"}`);

  if (manifest.package !== EXPECTED_PACKAGE) {
    fail(
      `El APK pertenece a "${manifest.package}", pero se esperaba "${EXPECTED_PACKAGE}".`,
    );
  }

  if (manifest.versionCode !== versionCode) {
    fail(
      `El versionCode del APK (${manifest.versionCode}) no coincide con --version-code (${versionCode}). ` +
        `Actualiza android/app/build.gradle, recompila el APK y vuelve a intentarlo.`,
    );
  }

  const versionName = args.versionName ?? manifest.versionName;
  if (!versionName) fail("No se pudo determinar versionName (pásalo con --version-name).");
  if (args.versionName && manifest.versionName && args.versionName !== manifest.versionName) {
    console.warn(
      `[aviso] --version-name (${args.versionName}) difiere del APK (${manifest.versionName}). Se usará ${versionName}.`,
    );
  }

  const gradleVersion = readGradleVersion();
  if (gradleVersion.versionCode !== versionCode) {
    fail(
      `android/app/build.gradle tiene versionCode ${gradleVersion.versionCode}, no ${versionCode}. ` +
        `El APK y el proyecto deben coincidir para que el updater detecte la versión.`,
    );
  }
  if (gradleVersion.versionName && gradleVersion.versionName !== versionName) {
    console.warn(
      `[aviso] build.gradle versionName (${gradleVersion.versionName}) difiere de la publicada (${versionName}).`,
    );
  }

  const minSupportedCode = args.minSupportedCode
    ? Number(args.minSupportedCode)
    : 0;
  if (!Number.isInteger(minSupportedCode) || minSupportedCode < 0) {
    fail("--min-supported-code debe ser un entero >= 0.");
  }
  if (minSupportedCode > versionCode) {
    fail("--min-supported-code no puede ser mayor que --version-code.");
  }

  const apkBuffer = fs.readFileSync(apkPath);
  assertApkSigned(apkBuffer);
  const sha256 = crypto.createHash("sha256").update(apkBuffer).digest("hex");
  const storagePath = `de-pana-${versionCode}.apk`;

  if (args.check) {
    console.log(`
✔ APK válido (modo --check, no se publicó nada)

  package:      ${manifest.package}
  versión:      ${versionName} (versionCode ${versionCode})
  tamaño:       ${(apkBuffer.length / (1024 * 1024)).toFixed(2)} MB
  sha256:       ${sha256}
  destino:      ${BUCKET}/${storagePath}
`);
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey =
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE;

  if (!supabaseUrl || !serviceKey) {
    fail(
      "Faltan credenciales. Define VITE_SUPABASE_URL (o SUPABASE_URL) y " +
        "SUPABASE_SERVICE_KEY (o SUPABASE_SERVICE_ROLE_KEY) en .env.",
    );
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: latest, error: latestError } = await supabase
    .from("app_releases")
    .select("version_code, version_name")
    .order("version_code", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (latestError) fail(`No se pudo leer app_releases: ${latestError.message}`);

  if (latest && versionCode <= latest.version_code && !args.force) {
    fail(
      `Ya existe una versión publicada con versionCode ${latest.version_code} (${latest.version_name}). ` +
        `Usa --force solo si necesitas reemplazarla.`,
    );
  }

  console.log(`\nSubiendo ${(apkBuffer.length / (1024 * 1024)).toFixed(2)} MB a Storage...`);
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, apkBuffer, {
      contentType: "application/vnd.android.package-archive",
      upsert: true,
      cacheControl: "3600",
    });

  if (uploadError) fail(`Error subiendo el APK: ${uploadError.message}`);

  const { error: upsertError } = await supabase.from("app_releases").upsert(
    {
      version_code: versionCode,
      version_name: versionName,
      apk_path: storagePath,
      apk_size: apkBuffer.length,
      notes: args.notes ?? null,
      mandatory: Boolean(args.mandatory),
      min_supported_code: minSupportedCode,
      active: true,
    },
    { onConflict: "version_code" },
  );

  if (upsertError) fail(`Error guardando la release: ${upsertError.message}`);

  const publicUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  console.log(`
✔ Publicado correctamente

  versión:      ${versionName} (versionCode ${versionCode})
  obligatoria:  ${args.mandatory ? "SÍ" : "no"}
  notas:        ${args.notes ?? "(sin notas)"}
  sha256:       ${sha256}
  APK:          ${publicUrl}

Los usuarios con versionCode < ${versionCode} verán el aviso al abrir la app.
`);
}

main().catch((error) => fail(error?.message ?? String(error)));
