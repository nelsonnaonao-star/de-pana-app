import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));

function printHelp() {
  console.log(`Uso:
  node security-tests/security-audit.mjs
  node security-tests/security-audit.mjs --rate-limit
  node security-tests/security-audit.mjs --write

Archivos:
  security-tests/security.env
  security-tests/security.env.example

Variables obligatorias:
  SECURITY_SUPABASE_URL
  SECURITY_SUPABASE_ANON_KEY
  SECURITY_A_EMAIL
  SECURITY_A_PASSWORD
  SECURITY_B_EMAIL
  SECURITY_B_PASSWORD

Variables opcionales:
  SECURITY_TARGET=staging
  SECURITY_ALLOW_WRITES=0
  SECURITY_I_UNDERSTAND=no
  SECURITY_B_PHONE
  SECURITY_B_CHAT_ID
  SECURITY_B_STORAGE_PATH
  SECURITY_REPORT_DIR

--write exige SECURITY_TARGET=staging, SECURITY_ALLOW_WRITES=1 y
SECURITY_I_UNDERSTAND=yes. Tambien rechaza la URL de .env.production.`);
}

if (args.has("--help") || args.has("-h")) {
  printHelp();
  process.exit(0);
}

function readEnvFile(file) {
  if (!existsSync(file)) return;
  const content = readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    if (process.env[match[1]] !== undefined) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

function readEnvValue(file, key) {
  if (!existsSync(file)) return "";
  const content = readFileSync(file, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || match[1] !== key) continue;
    let value = match[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    return value;
  }
  return "";
}

function clean(value) {
  return (value || "").trim().replace(/\/+$/, "");
}

const envFile = process.env.SECURITY_ENV_FILE
  ? resolve(process.env.SECURITY_ENV_FILE)
  : join(__dirname, "security.env");

readEnvFile(envFile);

const config = {
  url: clean(process.env.SECURITY_SUPABASE_URL),
  anonKey: (process.env.SECURITY_SUPABASE_ANON_KEY || "").trim(),
  aEmail: (process.env.SECURITY_A_EMAIL || "").trim(),
  aPassword: process.env.SECURITY_A_PASSWORD || "",
  bEmail: (process.env.SECURITY_B_EMAIL || "").trim(),
  bPassword: process.env.SECURITY_B_PASSWORD || "",
  bPhone: (process.env.SECURITY_B_PHONE || "").replace(/\D/g, ""),
  bChatId: (process.env.SECURITY_B_CHAT_ID || "").trim(),
  bStoragePath: (process.env.SECURITY_B_STORAGE_PATH || "").trim(),
  target: (process.env.SECURITY_TARGET || "").trim().toLowerCase(),
  allowWrites: (process.env.SECURITY_ALLOW_WRITES || "").trim() === "1",
  understand: (process.env.SECURITY_I_UNDERSTAND || "").trim().toLowerCase() === "yes",
  write: args.has("--write"),
  rateLimit: args.has("--rate-limit"),
  reportsDir: process.env.SECURITY_REPORT_DIR
    ? resolve(process.env.SECURITY_REPORT_DIR)
    : join(__dirname, "reports"),
};

const missing = [];
if (!config.url) missing.push("SECURITY_SUPABASE_URL");
if (!config.anonKey) missing.push("SECURITY_SUPABASE_ANON_KEY");
if (!config.aEmail) missing.push("SECURITY_A_EMAIL");
if (!config.aPassword) missing.push("SECURITY_A_PASSWORD");
if (!config.bEmail) missing.push("SECURITY_B_EMAIL");
if (!config.bPassword) missing.push("SECURITY_B_PASSWORD");

if (missing.length) {
  console.error(`Faltan variables: ${missing.join(", ")}`);
  console.error(`Archivo esperado: ${envFile}`);
  console.error("Copia security-tests/security.env.example a security-tests/security.env y completa los valores.");
  process.exit(2);
}

let targetHost = "";
try {
  const parsed = new URL(config.url);
  if (parsed.protocol !== "https:") throw new Error("La URL debe usar HTTPS.");
  targetHost = parsed.host;
} catch (error) {
  console.error(`SECURITY_SUPABASE_URL invalida: ${error.message}`);
  process.exit(2);
}

const productionUrl = clean(
  readEnvValue(join(repoRoot, ".env.production"), "VITE_SUPABASE_URL")
);

if (config.write) {
  if (!config.allowWrites || !config.understand || config.target !== "staging") {
    console.error("Modo escritura bloqueado.");
    console.error("Configura SECURITY_TARGET=staging, SECURITY_ALLOW_WRITES=1 y SECURITY_I_UNDERSTAND=yes.");
    process.exit(2);
  }
  if (productionUrl && config.url === productionUrl) {
    console.error("Modo escritura bloqueado: la URL coincide con .env.production.");
    process.exit(2);
  }
}

if (!config.write && productionUrl && config.url === productionUrl) {
  console.log("[WARN] La URL coincide con .env.production. Solo se ejecutaran pruebas de lectura.");
}

const SENSITIVE_KEYS = new Set([
  "phone",
  "phone_digits",
  "phone_number",
  "real_email",
  "email",
  "pin",
  "password",
  "password_hash",
  "access_token",
  "refresh_token",
  "fcm_token",
  "device_token",
  "secret",
  "api_key",
  "service_role",
]);

function rows(data) {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") return [data];
  return [];
}

function findSensitive(value) {
  const hits = [];
  const visit = (node, path) => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => visit(item, `${path}[${index}]`));
      return;
    }
    if (!node || typeof node !== "object") return;
    for (const [key, item] of Object.entries(node)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (
        SENSITIVE_KEYS.has(key.toLowerCase()) &&
        item !== null &&
        item !== undefined &&
        item !== "" &&
        typeof item !== "object"
      ) {
        hits.push(nextPath);
      }
      visit(item, nextPath);
    }
  };
  visit(value, "");
  return [...new Set(hits)];
}

function keyList(data) {
  const keys = new Set();
  for (const row of rows(data)) {
    if (!row || typeof row !== "object") continue;
    for (const key of Object.keys(row)) keys.add(key);
  }
  return [...keys].slice(0, 40);
}

function evidence(res, extra = {}) {
  return {
    status: res.status,
    rowCount: rows(res.data).length,
    keys: keyList(res.data),
    sensitive: findSensitive(res.data).slice(0, 20),
    ...extra,
  };
}

async function sbFetch(path, options = {}) {
  const {
    method = "GET",
    token,
    body,
    headers = {},
    contentType = "application/json",
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);

  try {
    const requestHeaders = { apikey: config.anonKey, ...headers };
    if (token) requestHeaders.Authorization = `Bearer ${token}`;

    let requestBody;
    if (body !== undefined) {
      requestHeaders["Content-Type"] = contentType;
      requestBody = typeof body === "string" ? body : JSON.stringify(body);
    }

    const response = await fetch(`${config.url}${path}`, {
      method,
      headers: requestHeaders,
      body: requestBody,
      signal: controller.signal,
    });

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    return {
      status: response.status,
      ok: response.ok,
      data,
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

function safeError(res) {
  const text =
    typeof res.data === "string" ? res.data : JSON.stringify(res.data || {});
  return text.slice(0, 300).replace(/password/gi, "[redacted]");
}

async function login(email, password, label) {
  const res = await sbFetch("/auth/v1/token?grant_type=password", {
    method: "POST",
    body: { email, password },
  });
  if (!res.ok || !res.data?.access_token || !res.data?.user?.id) {
    throw new Error(`${label} login fallido (${res.status}): ${safeError(res)}`);
  }
  return res.data;
}

function pass(detail, extra = {}) {
  return { status: "PASS", detail, evidence: extra };
}

function fail(detail, extra = {}) {
  return { status: "FAIL", detail, evidence: extra };
}

function skip(detail, extra = {}) {
  return { status: "SKIP", detail, evidence: extra };
}

function info(detail, extra = {}) {
  return { status: "INFO", detail, evidence: extra };
}

function blocked(res) {
  return [401, 403, 404].includes(res.status);
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

const results = [];

async function runTest(id, name, severity, fn) {
  const started = Date.now();
  try {
    const result = await fn();
    const entry = {
      id,
      name,
      severity,
      status: result.status,
      detail: result.detail || "",
      evidence: result.evidence || {},
      ms: Date.now() - started,
    };
    results.push(entry);
    console.log(`[${entry.status}] ${id} ${name} - ${entry.detail}`);
    return entry;
  } catch (error) {
    const entry = {
      id,
      name,
      severity,
      status: "ERROR",
      detail: error.name === "AbortError" ? "Timeout de red." : error.message,
      evidence: {},
      ms: Date.now() - started,
    };
    results.push(entry);
    console.log(`[ERROR] ${id} ${name} - ${entry.detail}`);
    return entry;
  }
}

function escapeCell(value) {
  return String(value || "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, " ");
}

function renderMarkdown(report) {
  const lines = [
    "# Security audit",
    "",
    `- Fecha: ${report.generatedAt}`,
    `- Target: ${report.target}`,
    `- Modo: ${report.mode}`,
    `- Total: ${report.summary.total}`,
    `- PASS: ${report.summary.pass}`,
    `- FAIL: ${report.summary.fail}`,
    `- INFO: ${report.summary.info}`,
    `- SKIP: ${report.summary.skip}`,
    `- ERROR: ${report.summary.error}`,
    `- Criticos: ${report.summary.critical}`,
    `- Altos: ${report.summary.high}`,
    "",
    "| ID | Prueba | Estado | Severidad | Detalle |",
    "| --- | --- | --- | --- | --- |",
  ];
  for (const result of report.results) {
    lines.push(
      `| ${escapeCell(result.id)} | ${escapeCell(result.name)} | ${result.status} | ${result.severity} | ${escapeCell(result.detail)} |`
    );
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  console.log(`Target: ${targetHost}`);
  console.log(`Modo: ${config.write ? "write" : "read"}`);

  const A = await login(config.aEmail, config.aPassword, "A");
  const B = await login(config.bEmail, config.bPassword, "B");
  const Aid = A.user.id;
  const Bid = B.user.id;

  console.log(`Usuario A: ${Aid}`);
  console.log(`Usuario B: ${Bid}`);

  const bSelf = await sbFetch("/rest/v1/rpc/get_my_profile", {
    method: "POST",
    token: B.access_token,
    body: {},
  });
  const bSelfRow = rows(bSelf.data)[0] || {};
  const bPhone =
    config.bPhone ||
    String(bSelfRow.phone || bSelfRow.phone_number || bSelfRow.phone_digits || "").replace(/\D/g, "");

  let Bchat = config.bChatId;
  if (!Bchat) {
    const chats = await sbFetch("/rest/v1/rpc/get_user_chats", {
      method: "POST",
      token: B.access_token,
      body: { user_uuid: Bid },
    });
    if (chats.ok && Array.isArray(chats.data) && chats.data.length) {
      Bchat = chats.data[0].id;
    }
  }

  if (Bchat) console.log(`Chat B: ${Bchat}`);
  if (bPhone) console.log(`Telefono B: configurado`);
  else console.log("Telefono B: no configurado; se saltara la prueba de enumeracion");

  await runTest("ANON-01", "Anon no lee PII de B en profiles", "critical", async () => {
    const res = await sbFetch(`/rest/v1/profiles?select=*&id=eq.${Bid}`);
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    const sensitive = findSensitive(res.data);
    if (sensitive.length) return fail(`Expone: ${sensitive.join(", ")}`, evidence(res));
    if (rows(res.data).length) return pass("Fila visible sin campos sensibles", evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("ANON-02", "Anon no lee contacts de B", "high", async () => {
    const res = await sbFetch(`/rest/v1/contacts?select=*&user_id=eq.${Bid}`);
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} filas`, evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("ANON-03", "Anon no ejecuta get_user_chats de B", "critical", async () => {
    const res = await sbFetch("/rest/v1/rpc/get_user_chats", {
      method: "POST",
      body: { user_uuid: Bid },
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail("Anon obtuvo chats", evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("ANON-04", "Anon no lista chat-media privado", "critical", async () => {
    const res = await sbFetch("/storage/v1/object/list/chat-media", {
      method: "POST",
      body: { prefix: "", limit: 5, offset: 0 },
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} objetos`, evidence(res));
    return pass("Sin objetos", evidence(res));
  });

  await runTest("BOLA-01", "A no lee PII de B en profiles", "critical", async () => {
    const res = await sbFetch(`/rest/v1/profiles?select=*&id=eq.${Bid}`, {
      token: A.access_token,
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    const sensitive = findSensitive(res.data);
    if (sensitive.length) return fail(`Expone: ${sensitive.join(", ")}`, evidence(res));
    if (rows(res.data).length) return pass("Fila visible sin campos sensibles", evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("BOLA-02", "A no lee contacts de B", "high", async () => {
    const res = await sbFetch(`/rest/v1/contacts?select=*&user_id=eq.${Bid}`, {
      token: A.access_token,
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} filas`, evidence(res));
    return pass("Sin filas", evidence(res));
  });

  if (Bchat) {
    await runTest("BOLA-03", "A no lee el chat de B", "critical", async () => {
      const res = await sbFetch(`/rest/v1/chats?select=*&id=eq.${Bchat}`, {
        token: A.access_token,
      });
      if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
      if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
      if (rows(res.data).length) return fail("Expuso el chat", evidence(res));
      return pass("Sin filas", evidence(res));
    });

    await runTest("BOLA-04", "A no lee mensajes de B", "critical", async () => {
      const res = await sbFetch(
        `/rest/v1/messages?select=*&chat_id=eq.${Bchat}&limit=5`,
        { token: A.access_token }
      );
      if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
      if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
      if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} mensajes`, evidence(res));
      return pass("Sin filas", evidence(res));
    });

    await runTest("BOLA-05", "A no lee mensajes de B via RPC con user_uuid=B", "critical", async () => {
      const res = await sbFetch("/rest/v1/rpc/get_user_messages", {
        method: "POST",
        token: A.access_token,
        body: {
          chat_uuid: Bchat,
          user_uuid: Bid,
          p_limit: 5,
          p_before: null,
          p_after: null,
        },
      });
      if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
      if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
      if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} mensajes`, evidence(res));
      return pass("Sin filas", evidence(res));
    });

    await runTest("BOLA-06", "A no lee chat B via RPC con user_uuid=A", "critical", async () => {
      const res = await sbFetch("/rest/v1/rpc/get_user_messages", {
        method: "POST",
        token: A.access_token,
        body: {
          chat_uuid: Bchat,
          user_uuid: Aid,
          p_limit: 5,
          p_before: null,
          p_after: null,
        },
      });
      if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
      if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
      if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} mensajes`, evidence(res));
      return pass("Sin filas", evidence(res));
    });

    await runTest("BOLA-07", "A no accede a chat-media de B", "critical", async () => {
      if (!config.bStoragePath) {
        return skip("Configura SECURITY_B_STORAGE_PATH para probar lectura directa");
      }
      const path = config.bStoragePath
        .split("/")
        .map((part) => encodeURIComponent(part))
        .join("/");
      const res = await sbFetch(
        `/storage/v1/object/authenticated/chat-media/${path}`,
        { token: A.access_token }
      );
      if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
      if (res.ok && res.text) return fail("A pudo leer el objeto privado", evidence(res));
      return pass(`Sin contenido (${res.status})`, evidence(res));
    });
  } else {
    await runTest("BOLA-03", "A no lee el chat de B", "critical", async () =>
      skip("B no tiene chats; configura SECURITY_B_CHAT_ID o crea datos semilla")
    );
    await runTest("BOLA-04", "A no lee mensajes de B", "critical", async () =>
      skip("B no tiene chats")
    );
    await runTest("BOLA-05", "A no lee mensajes de B via RPC con user_uuid=B", "critical", async () =>
      skip("B no tiene chats")
    );
    await runTest("BOLA-06", "A no lee chat B via RPC con user_uuid=A", "critical", async () =>
      skip("B no tiene chats")
    );
    await runTest("BOLA-07", "A no accede a chat-media de B", "critical", async () =>
      skip("B no tiene chats")
    );
  }

  await runTest("BOLA-08", "A no lee calls de B", "high", async () => {
    const res = await sbFetch(
      `/rest/v1/calls?select=*&or=(caller_id.eq.${Bid},callee_id.eq.${Bid})&limit=5`,
      { token: A.access_token }
    );
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} llamadas`, evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("BOLA-09", "A no lee blocks de B", "medium", async () => {
    const res = await sbFetch(`/rest/v1/blocks?select=*&blocker_id=eq.${Bid}`, {
      token: A.access_token,
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} filas`, evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("BOLA-10", "A no lee presence de B", "medium", async () => {
    const res = await sbFetch(`/rest/v1/user_presence?select=*&user_id=eq.${Bid}`, {
      token: A.access_token,
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} filas`, evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("BOLA-11", "A no lee chat_clears de B", "medium", async () => {
    const res = await sbFetch(`/rest/v1/chat_clears?select=*&user_id=eq.${Bid}`, {
      token: A.access_token,
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    if (rows(res.data).length) return fail(`Expuso ${rows(res.data).length} filas`, evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("BOLA-12", "A no obtiene chats de B via RPC", "critical", async () => {
    const res = await sbFetch("/rest/v1/rpc/get_user_chats", {
      method: "POST",
      token: A.access_token,
      body: { user_uuid: Bid },
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    const items = rows(res.data);
    if (Bchat && items.some((item) => item.id === Bchat)) {
      return fail("Devolvio el chat de B", evidence(res));
    }
    if (items.length) return info("Devolvio filas, revisar si son de A", evidence(res));
    return pass("Sin filas", evidence(res));
  });

  await runTest("DATA-01", "get_public_profile no expone PII de B", "high", async () => {
    const res = await sbFetch("/rest/v1/rpc/get_public_profile", {
      method: "POST",
      token: A.access_token,
      body: { p_id: Bid },
    });
    if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
    if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
    const sensitive = findSensitive(res.data);
    if (sensitive.length) return fail(`Expone: ${sensitive.join(", ")}`, evidence(res));
    if (rows(res.data).length) return pass("Solo campos publicos", evidence(res));
    return pass("Sin filas", evidence(res));
  });

  if (bPhone) {
    await runTest("DATA-02", "match_profiles_by_phones no expone PII de B", "high", async () => {
      const res = await sbFetch("/rest/v1/rpc/match_profiles_by_phones", {
        method: "POST",
        token: A.access_token,
        body: { p_phones: [bPhone], p_limit: 10 },
      });
      if (blocked(res)) return pass(`Bloqueado (${res.status})`, evidence(res));
      if (!res.ok) return info(`Respuesta inesperada ${res.status}`, evidence(res));
      const sensitive = findSensitive(res.data);
      if (sensitive.length) return fail(`Expone: ${sensitive.join(", ")}`, evidence(res));
      if (rows(res.data).length) return pass("Solo campos publicos y matched_phone", evidence(res));
      return pass("Sin coincidencias", evidence(res));
    });
  } else {
    await runTest("DATA-02", "match_profiles_by_phones no expone PII de B", "high", async () =>
      skip("SECURITY_B_PHONE no configurado")
    );
  }

  if (config.rateLimit) {
    await runTest("RATE-01", "Rate limit en validate_promo_code", "medium", async () => {
      const statuses = {};
      for (let index = 1; index <= 20; index += 1) {
        const res = await sbFetch("/rest/v1/rpc/validate_promo_code", {
          method: "POST",
          token: A.access_token,
          body: { p_code: `SECURITY-AUDIT-${index}` },
        });
        statuses[res.status] = (statuses[res.status] || 0) + 1;
        await sleep(200);
      }
      if (statuses[429]) return pass("429 detectado", { statuses });
      return info("No se observo 429 en 20 intentos; validar limite real", { statuses });
    });
  }

  if (config.write) {
    await runTest("WRITE-01", "A no puede autoasignarse role=admin", "critical", async () => {
      const before = await sbFetch(`/rest/v1/profiles?select=role&id=eq.${Aid}`, {
        token: A.access_token,
      });
      const original = rows(before.data)[0]?.role;
      if (original === undefined) return skip("No se pudo leer role de A", evidence(before));
      if (original === "admin") return skip("A ya es admin en staging");
      let changed = false;
      try {
        const write = await sbFetch(`/rest/v1/profiles?id=eq.${Aid}`, {
          method: "PATCH",
          token: A.access_token,
          body: { role: "admin" },
          headers: { Prefer: "return=representation" },
        });
        const after = await sbFetch(`/rest/v1/profiles?select=role&id=eq.${Aid}`, {
          token: A.access_token,
        });
        changed = rows(after.data)[0]?.role === "admin";
        if (changed) {
          return fail("A pudo autoasignarse admin", evidence(after, { writeStatus: write.status }));
        }
        return pass(`Bloqueado (${write.status})`, evidence(write));
      } finally {
        if (changed) {
          await sbFetch(`/rest/v1/profiles?id=eq.${Aid}`, {
            method: "PATCH",
            token: A.access_token,
            body: { role: original },
            headers: { Prefer: "return=representation" },
          });
        }
      }
    });

    await runTest("WRITE-02", "A no puede escribir la bio de B", "critical", async () => {
      const before = await sbFetch(`/rest/v1/profiles?select=bio&id=eq.${Bid}`, {
        token: B.access_token,
      });
      const original = rows(before.data)[0]?.bio;
      if (original === undefined) return skip("No se pudo leer bio de B", evidence(before));
      const canary = `SECURITY_AUDIT_${Date.now()}`;
      let changed = false;
      try {
        const write = await sbFetch(`/rest/v1/profiles?id=eq.${Bid}`, {
          method: "PATCH",
          token: A.access_token,
          body: { bio: canary },
          headers: { Prefer: "return=representation" },
        });
        const after = await sbFetch(`/rest/v1/profiles?select=bio&id=eq.${Bid}`, {
          token: B.access_token,
        });
        changed = rows(after.data)[0]?.bio === canary;
        if (changed) {
          return fail("A pudo escribir la bio de B", evidence(after, { writeStatus: write.status }));
        }
        return pass(`Bloqueado (${write.status})`, evidence(write));
      } finally {
        if (changed) {
          await sbFetch(`/rest/v1/profiles?id=eq.${Bid}`, {
            method: "PATCH",
            token: B.access_token,
            body: { bio: original },
            headers: { Prefer: "return=representation" },
          });
        }
      }
    });

    await runTest("WRITE-03", "A no puede modificar app_releases", "critical", async () => {
      const list = await sbFetch("/rest/v1/app_releases?select=id,notes&active=eq.true&limit=1", {
        token: A.access_token,
      });
      if (!list.ok) return skip(`No se pudo leer app_releases (${list.status})`, evidence(list));
      const release = rows(list.data)[0];
      if (!release?.id) return skip("No hay release activa visible", evidence(list));
      const original = release.notes;
      const canary = `SECURITY_AUDIT_${Date.now()}`;
      let changed = false;
      try {
        const write = await sbFetch(`/rest/v1/app_releases?id=eq.${release.id}`, {
          method: "PATCH",
          token: A.access_token,
          body: { notes: canary },
          headers: { Prefer: "return=representation" },
        });
        const after = await sbFetch(`/rest/v1/app_releases?select=notes&id=eq.${release.id}`, {
          token: A.access_token,
        });
        changed = rows(after.data)[0]?.notes === canary;
        if (changed) {
          return fail("A pudo modificar app_releases", evidence(after, { writeStatus: write.status }));
        }
        return pass(`Bloqueado (${write.status})`, evidence(write));
      } finally {
        if (changed) {
          await sbFetch(`/rest/v1/app_releases?id=eq.${release.id}`, {
            method: "PATCH",
            token: A.access_token,
            body: { notes: original },
            headers: { Prefer: "return=representation" },
          });
        }
      }
    });

    await runTest("WRITE-04", "A no puede subir a app-updates", "critical", async () => {
      const name = `security-audit-${Date.now()}.txt`;
      const path = `/storage/v1/object/app-updates/${name}`;
      let uploaded = false;
      try {
        const upload = await sbFetch(path, {
          method: "POST",
          token: A.access_token,
          body: "security audit",
          contentType: "text/plain",
          headers: { "x-upsert": "false" },
        });
        uploaded = upload.ok;
        if (uploaded) {
          return fail("A pudo subir a app-updates", evidence(upload, { object: name }));
        }
        return pass(`Bloqueado (${upload.status})`, evidence(upload));
      } finally {
        if (uploaded) {
          await sbFetch(path, { method: "DELETE", token: A.access_token });
        }
      }
    });
  }

  const summary = {
    total: results.length,
    pass: 0,
    fail: 0,
    info: 0,
    skip: 0,
    error: 0,
    critical: 0,
    high: 0,
  };

  for (const result of results) {
    const key = result.status.toLowerCase();
    if (summary[key] !== undefined) summary[key] += 1;
    if (result.status === "FAIL" && result.severity === "critical") summary.critical += 1;
    if (result.status === "FAIL" && result.severity === "high") summary.high += 1;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    target: targetHost,
    mode: config.write ? "write" : "read",
    summary,
    results,
  };

  mkdirSync(config.reportsDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const jsonPath = join(config.reportsDir, `security-audit-${stamp}.json`);
  const mdPath = join(config.reportsDir, `security-audit-${stamp}.md`);

  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  writeFileSync(mdPath, renderMarkdown(report));

  console.log("");
  console.log(
    `Resumen: ${summary.total} pruebas, ${summary.pass} PASS, ${summary.fail} FAIL, ${summary.info} INFO, ${summary.skip} SKIP, ${summary.error} ERROR`
  );
  console.log(`Criticos: ${summary.critical}; altos: ${summary.high}`);
  console.log(`Reporte JSON: ${jsonPath}`);
  console.log(`Reporte MD: ${mdPath}`);

  process.exit(summary.critical > 0 || summary.high > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(`Error fatal: ${error.message}`);
  process.exit(2);
});
