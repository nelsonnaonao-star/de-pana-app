import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const allowProduction = args.has("--allow-production");

function readEnvValue(file, key) {
  if (!existsSync(file)) return "";
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  for (const line of lines) {
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

function password() {
  return `Sa!${randomBytes(18).toString("base64url")}`;
}

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

const url = clean(readEnvValue(join(repoRoot, ".env"), "VITE_SUPABASE_URL"));
const serviceKey = readEnvValue(join(repoRoot, ".env"), "SUPABASE_SERVICE_KEY");
const anonKey = readEnvValue(join(repoRoot, ".env"), "VITE_SUPABASE_ANON_KEY");
const productionUrl = clean(readEnvValue(join(repoRoot, ".env.production"), "VITE_SUPABASE_URL"));

if (!url || !serviceKey || !anonKey) {
  console.error("Faltan VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY o VITE_SUPABASE_ANON_KEY en .env");
  process.exit(2);
}

const isProduction = Boolean(productionUrl && url === productionUrl);
if (isProduction && !allowProduction) {
  console.error("La URL coincide con .env.production. Usa --allow-production solo si es un entorno de pruebas controlado.");
  process.exit(2);
}

if (!apply) {
  console.log("Dry-run. Usa --apply para crear usuarios, perfiles, chat y mensaje semilla.");
  console.log(`URL: ${url}`);
  console.log(`Entorno detectado: ${isProduction ? "produccion/preproduccion" : "staging"}`);
  process.exit(0);
}

const suffix = stamp();
const emailA = `security.audit.a.${suffix}@example.com`;
const emailB = `security.audit.b.${suffix}@example.com`;
const passA = password();
const passB = password();
const phoneA = `1809${String(Date.now()).slice(-7)}1`;
const phoneB = `1809${String(Date.now()).slice(-7)}2`;
const nameA = `Security Audit A ${suffix}`;
const nameB = `Security Audit B ${suffix}`;
const usernameA = `security_audit_a_${suffix}`;
const usernameB = `security_audit_b_${suffix}`;

async function request(path, options = {}) {
  const {
    method = "GET",
    body,
    token = serviceKey,
    headers = {},
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);

  try {
    const requestHeaders = {
      apikey: serviceKey,
      Authorization: `Bearer ${token}`,
      ...headers,
    };

    let requestBody;
    if (body !== undefined) {
      requestHeaders["Content-Type"] = "application/json";
      requestBody = JSON.stringify(body);
    }

    const response = await fetch(`${url}${path}`, {
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

    if (!response.ok) {
      const detail = typeof data === "string" ? data : JSON.stringify(data);
      throw new Error(`${method} ${path} -> ${response.status}: ${detail.slice(0, 500)}`);
    }

    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function createUser(email, pass, name) {
  const data = await request("/auth/v1/admin/users", {
    method: "POST",
    body: {
      email,
      password: pass,
      email_confirm: true,
      user_metadata: { name },
    },
  });
  const user = data?.user || data;
  if (!user?.id) throw new Error(`No se obtuvo id para ${email}`);
  return user;
}

async function createProfile(user, name, username, phone) {
  const body = {
    id: user.id,
    name,
    display_name: name,
    username,
    email: user.email,
    real_email: user.email,
    phone_number: phone,
    phone_digits: phone,
    role: "Usuario",
    status: "offline",
    bio: "Cuenta temporal de auditoria de seguridad",
  };

  const existing = await request(`/rest/v1/profiles?id=eq.${user.id}&select=id`);

  if (Array.isArray(existing) && existing.length > 0) {
    const data = await request(`/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      body,
      headers: { Prefer: "return=representation" },
    });
    return Array.isArray(data) ? data[0] : data;
  }

  try {
    const data = await request("/rest/v1/profiles", {
      method: "POST",
      body,
      headers: { Prefer: "return=representation" },
    });
    return Array.isArray(data) ? data[0] : data;
  } catch (error) {
    if (!String(error.message).includes("409")) throw error;
    const data = await request(`/rest/v1/profiles?id=eq.${user.id}`, {
      method: "PATCH",
      body,
      headers: { Prefer: "return=representation" },
    });
    return Array.isArray(data) ? data[0] : data;
  }
}

async function createChat(a, b, text) {
  const now = new Date().toISOString();
  const body = {
    profile_id: a.id,
    admin_id: b.id,
    is_group: false,
    name: `Security Audit ${a.name} / ${b.name}`,
    last_message: text,
    last_message_time: now,
    created_at: now,
    updated_at: now,
  };
  const data = await request("/rest/v1/chats", {
    method: "POST",
    body,
    headers: { Prefer: "return=representation" },
  });
  return Array.isArray(data) ? data[0] : data;
}

async function createMessage(chat, sender, receiver, text) {
  const now = new Date().toISOString();
  const body = {
    chat_id: chat.id,
    sender_id: sender.id,
    receiver_id: receiver.id,
    text,
    type: "text",
    status: "sent",
    created_at: now,
    edited: false,
    forwarded: false,
    is_deleted: false,
    is_ephemeral: false,
    has_image: false,
    has_audio: false,
    has_video: false,
    has_document: false,
    has_location: false,
    is_animated: false,
  };
  const data = await request("/rest/v1/messages", {
    method: "POST",
    body,
    headers: { Prefer: "return=representation" },
  });
  return Array.isArray(data) ? data[0] : data;
}

async function main() {
  console.log(`Creando usuarios de prueba en ${url}`);
  const userA = await createUser(emailA, passA, nameA);
  const userB = await createUser(emailB, passB, nameB);

  const profileA = await createProfile(userA, nameA, usernameA, phoneA);
  const profileB = await createProfile(userB, nameB, usernameB, phoneB);

  const text = "Mensaje semilla de auditoria de seguridad";
  const chat = await createChat(profileA, profileB, text);
  const message = await createMessage(chat, profileB, profileA, text);

  const target = isProduction ? "preproduction" : "staging";
  const envContent = [
    `SECURITY_TARGET=${target}`,
    `SECURITY_SUPABASE_URL=${url}`,
    `SECURITY_SUPABASE_ANON_KEY=${anonKey}`,
    `SECURITY_A_EMAIL=${emailA}`,
    `SECURITY_A_PASSWORD=${passA}`,
    `SECURITY_B_EMAIL=${emailB}`,
    `SECURITY_B_PASSWORD=${passB}`,
    `SECURITY_B_PHONE=${phoneB}`,
    `SECURITY_B_CHAT_ID=${chat.id}`,
    "SECURITY_B_STORAGE_PATH=",
    "SECURITY_ALLOW_WRITES=0",
    "SECURITY_I_UNDERSTAND=no",
  ].join("\r\n");

  const envPath = join(__dirname, "security.env");
  writeFileSync(envPath, envContent, "utf8");

  const reportsDir = join(__dirname, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const bootstrapPath = join(reportsDir, `bootstrap-${suffix}.json`);
  writeFileSync(
    bootstrapPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        target,
        url,
        users: {
          a: { id: userA.id, email: emailA, profileId: profileA.id, name: nameA, phone: phoneA },
          b: { id: userB.id, email: emailB, profileId: profileB.id, name: nameB, phone: phoneB },
        },
        chatId: chat.id,
        messageId: message.id,
        envPath,
      },
      null,
      2
    )
  );

  console.log("");
  console.log(`A: ${emailA} (${userA.id})`);
  console.log(`B: ${emailB} (${userB.id})`);
  console.log(`Chat B: ${chat.id}`);
  console.log(`Mensaje: ${message.id}`);
  console.log(`Entorno: ${target}`);
  console.log(`Config: ${envPath}`);
  console.log(`Bootstrap: ${bootstrapPath}`);
  console.log("Las passwords quedaron solo en security.env.");
}

main().catch((error) => {
  console.error(`Error: ${error.message}`);
  process.exit(1);
});
