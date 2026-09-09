import nodemailer from 'nodemailer';

const host = process.env.SMTP_HOST || 'smtp.gmail.com';
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const secure = process.env.SMTP_SECURE === 'true';
const user = process.env.SMTP_USER || '';
const pass = process.env.SMTP_PASS || '';
const from = process.env.SMTP_FROM || user;

let transporter = null;

if (user && pass) {
  transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    connectionTimeout: 15000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  console.log(`[EMAIL] SMTP configurado → ${host}:${port}`);
} else {
  console.warn('[EMAIL] SMTP no configurado (faltan SMTP_USER / SMTP_PASS)');
}

export async function sendResetEmail(to, pin) {
  if (!transporter) {
    throw new Error('Servicio de correo no configurado');
  }

  const info = await transporter.sendMail({
    from,
    to,
    subject: 'RED ON — Código de recuperación',
    text: `Tu código de recuperación es: ${pin}\nVálido por 15 minutos.\nNo compartas este código.`,
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:sans-serif;max-width:400px;margin:0 auto;padding:20px">
      <h2 style="color:#0d9488;margin-bottom:4px">RED ON</h2>
      <p style="color:#475569;font-size:14px">Tu código de recuperación es:</p>
      <div style="font-size:36px;font-weight:bold;letter-spacing:10px;text-align:center;padding:20px;background:#f0fdfa;border-radius:12px;color:#0d9488;margin:16px 0">${pin}</div>
      <p style="color:#94a3b8;font-size:12px">Válido por 15 minutos. No compartas este código.</p>
    </body></html>`,
  });

  console.log(`[EMAIL] Enviado a ${to} → ${info.messageId}`);
  return info.messageId;
}
