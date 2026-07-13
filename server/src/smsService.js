import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const fromNumber = process.env.TWILIO_PHONE_NUMBER;

let client = null;
if (accountSid && authToken) {
  client = twilio(accountSid, authToken);
  console.log('[SMS] Twilio configurado');
} else {
  console.warn('[SMS] Twilio no configurado (faltan TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)');
}

export async function sendResetSMS(phoneNumber, pin) {
  if (!client) {
    console.warn(`[SMS] Twilio no disponible. PIN para ${phoneNumber}: ${pin}`);
    throw new Error('Servicio de SMS no configurado');
  }

  const cleanPhone = phoneNumber.replace(/[^\d+]/g, '');
  const formatted = cleanPhone.startsWith('+') ? cleanPhone : `+${cleanPhone}`;

  try {
    const msg = await client.messages.create({
      body: `[RED ON] Tu código de recuperación es: ${pin}\nVálido por 15 minutos.\nNo compartas este código.`,
      from: fromNumber,
      to: formatted,
    });
    console.log(`[SMS] Enviado a ${formatted} → SID: ${msg.sid}`);
    return msg.sid;
  } catch (err) {
    console.error(`[SMS] Error enviando a ${formatted}:`, err.message);
    throw err;
  }
}
