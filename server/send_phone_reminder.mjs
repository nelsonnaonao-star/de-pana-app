import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { config } from 'dotenv';

config({ path: './.env' });

const url = process.env.VITE_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_KEY;
const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON || process.env.FIREBASE_SERVICE_ACCOUNT;

if (!url || !serviceKey) {
  console.error('Faltan VITE_SUPABASE_URL o SUPABASE_SERVICE_KEY en .env');
  process.exit(1);
}
if (!raw) {
  console.error('FIREBASE_SERVICE_ACCOUNT_JSON no configurada en .env');
  process.exit(1);
}

const serviceAccount = JSON.parse(raw);
if (serviceAccount.private_key) {
  serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

if (getApps().length === 0) {
  initializeApp({ credential: cert(serviceAccount) });
}

const messaging = getMessaging();
const headers = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` };

async function getJson(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path} ${res.status} ${await res.text()}`);
  return res.json();
}

const profiles = await getJson('profiles?select=id,username,phone_number');
const targets = profiles.filter((p) => !p.phone_number && p.username);
const ids = targets.map((p) => p.id);

if (ids.length === 0) {
  console.log('No hay perfiles sin teléfono con username.');
  process.exit(0);
}

const inList = ids.join(',');
const tokens = await getJson(
  `push_tokens?select=token,profile_id&profile_id=in.(${inList})&device=eq.android-fcm`
);

const uniqueTokens = [...new Set(tokens.map((t) => t.token).filter(Boolean))];
const targetedProfiles = new Set(tokens.map((t) => t.profile_id));

console.log(
  JSON.stringify(
    {
      profiles_without_phone_with_username: targets.length,
      profiles_with_android_token: targetedProfiles.size,
      android_tokens: uniqueTokens.length,
      mode: process.argv.includes('--send') ? 'send' : 'dry-run',
    },
    null,
    2
  )
);

if (!process.argv.includes('--send')) {
  console.log('Dry-run: para enviar, ejecuta node send_phone_reminder.mjs --send');
  process.exit(0);
}

const chunkSize = 500;
let success = 0;
let failure = 0;

for (let i = 0; i < uniqueTokens.length; i += chunkSize) {
  const chunk = uniqueTokens.slice(i, i + chunkSize);
  const response = await messaging.sendEachForMulticast({
    tokens: chunk,
    notification: {
      title: 'Completa tu número en WEPA',
      body: 'Tus contactos no pueden encontrarte. Abre WEPA y agrega tu teléfono.',
    },
    data: {
      title: 'Completa tu número en WEPA',
      body: 'Tus contactos no pueden encontrarte. Abre WEPA y agrega tu teléfono.',
      type: 'complete_phone',
    },
    android: {
      priority: 'high',
      ttl: 86400000,
      notification: {
        channel_id: 'redon-messages',
        click_action: 'OPEN_APP',
        visibility: 'public',
        sound: 'notificacion',
      },
    },
  });
  success += response.successCount;
  failure += response.failureCount;
}

console.log(JSON.stringify({ sent: success, failed: failure }, null, 2));
