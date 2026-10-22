import { Router } from 'express';
import { randomInt, randomUUID } from 'crypto';
import { supabaseAdmin } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendResetEmail } from '../emailService.js';

const router = Router();

// ─── Rate limiters ────────────────────────────────────────────────
// Defensa en capas (se suman, nunca se debilitan):
//  - Global: todas las rutas de este router están montadas en /api/auth tras
//    `strictLimiter` (index.js): 5 req/min por IP COMPARTIDO por todos los
//    endpoints de auth.
//  - Específicos (aquí), adicionales al global:
//      * send-reset-code:            5  / 15 min
//      * send-reset-email:           3  / 15 min
//      * verify-reset-code + update-password: COMPARTEN `verifyLimiter`
//        (10 / 15 min) para que no se pueda eludir alternando de endpoint.
//  Cada ventana se evalúa por separado, de modo que manda el límite más
//  restrictivo de cada una. Estos limitadores NO sustituyen al bloqueo por
//  intentos del propio código (`MAX_RESET_ATTEMPTS`, atómico en PostgreSQL).
import rateLimit from 'express-rate-limit';

const resetCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Demasiados intentos de verificación.' },
});

const profileLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiadas solicitudes.' },
});

const emailRecoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Demasiados intentos. Espera 15 minutos.' },
});

const MAX_RESET_ATTEMPTS = 5;

function generateCode() {
  return String(randomInt(100000, 1000000));
}

const RESET_CODE_TTL_MS = 15 * 60 * 1000;

// Enmascara el correo para las respuestas (p. ej. vi******@example.com).
function maskEmail(email) {
  const [local, domain] = String(email).split('@');
  if (!local || !domain) return String(email);
  const hidden = local.length > 2 ? '*'.repeat(Math.max(2, local.length - 2)) : '**';
  return `${local.slice(0, 2)}${hidden}@${domain}`;
}

// Carga el único registro activo (sin usar y vigente) del perfil.
// Devuelve { record } o { error }. `record` es undefined si no hay ninguno.
// Nota: supabase-js resuelve `.select().limit(1)` con un ARRAY, por lo que se
// normaliza aquí (el código previo lo trataba como objeto → siempre fallaba).
async function loadActiveResetRecord(profileId) {
  const now = new Date().toISOString();
  const { data, error } = await supabaseAdmin
    .from('password_reset_codes')
    .select('id, profile_id, code, phone, expires_at, attempts, used')
    .eq('profile_id', profileId)
    .eq('used', false)
    .gt('expires_at', now)
    .order('id', { ascending: false })
    .limit(1);

  if (error) return { error };
  const record = Array.isArray(data) ? data[0] : data;
  return { record: record || undefined };
}

// Registra un intento fallido sobre el registro activo mediante una operación
// ATÓMICA en PostgreSQL. NO se usa `.update()` de supabase-js: PostgREST no
// admite `attempts = attempts + 1`, y un read-modify-write pierde incrementos
// concurrentes. La función `increment_password_reset_attempt` (ver migración
// 019, pendiente de revisión) incrementa y bloquea el código al alcanzar el
// máximo en una única sentencia.
// Compartido por verify y update para que los intentos NO puedan eludirse
// cambiando de endpoint. Devuelve { attempts, locked } o { error }.
async function registerFailedResetAttempt(record) {
  const { data, error } = await supabaseAdmin.rpc('increment_password_reset_attempt', {
    p_id: record.id,
    p_max_attempts: MAX_RESET_ATTEMPTS,
  });

  if (error) return { error };

  const row = Array.isArray(data) ? data[0] : data;
  if (!row) {
    // 0 filas: el código ya estaba usado/bloqueado por una petición concurrente.
    return { attempts: null, locked: true, alreadyLocked: true };
  }
  return { attempts: row.attempts, locked: !!row.used };
}

// Consumo atómico y de un solo uso: solo actualiza si el código sigue sin usar.
// El UPDATE condicional garantiza que, ante solicitudes concurrentes, una sola
// obtenga `consumed = true`.
async function consumeResetCode(recordId) {
  const { data, error } = await supabaseAdmin
    .from('password_reset_codes')
    .update({ used: true })
    .eq('id', recordId)
    .eq('used', false)
    .select('id');

  if (error) return { error };
  return { consumed: Array.isArray(data) && data.length > 0 };
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, 500);
}

// ─── Email Password Recovery ───────────────────────────────────────

// Step 1: Send reset code via email (lookup by email → send PIN)
router.post('/send-reset-code', resetCodeLimiter, async (req, res) => {
  const startedAt = Date.now();
  const genericMessage = 'Si la cuenta existe, recibirás un código de verificación por correo electrónico.';

  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Correo electrónico requerido' });

    const cleanEmail = sanitizeInput(email).toLowerCase().trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({ error: 'Correo electrónico inválido' });
    }

    // Look up profile by real_email (RLS bypass via service_role)
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, real_email')
      .eq('real_email', cleanEmail)
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[EMAIL-RECOVERY] Supabase lookup error:', error);
      return res.status(500).json({ error: 'Error al buscar el usuario' });
    }

    // Respuesta uniforme: misma forma exista o no la cuenta (anti-enumeración).
    // Para un correo inexistente se devuelve un profileId aleatorio que,
    // simplemente, no tendrá código asociado y fallará de forma genérica.
    if (!profile?.real_email) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      return res.json({
        message: genericMessage,
        maskedEmail: maskEmail(cleanEmail),
        profileId: randomUUID(),
        expiresIn: RESET_CODE_TTL_MS / 1000,
      });
    }

    // Invalidate any previous unused codes for this profile
    await supabaseAdmin
      .from('password_reset_codes')
      .update({ used: true })
      .eq('profile_id', profile.id)
      .eq('used', false);

    // Generate new 6-digit code (15 min expiry)
    const code = generateCode();
    const expiresAt = new Date(Date.now() + RESET_CODE_TTL_MS).toISOString();

    await supabaseAdmin
      .from('password_reset_codes')
      .insert({
        profile_id: profile.id,
        code,
        phone: profile.real_email,
        expires_at: expiresAt,
        attempts: 0,
      });

    const maskedEmail = maskEmail(profile.real_email);

    try {
      await sendResetEmail(profile.real_email, code);
    } catch (emailErr) {
      console.error('[EMAIL-RECOVERY] Email send failed:', emailErr.message);
    }

    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));

    res.json({
      message: genericMessage,
      maskedEmail,
      profileId: profile.id,
      expiresIn: RESET_CODE_TTL_MS / 1000,
    });
  } catch (err) {
    console.error('[EMAIL-RECOVERY] Error:', err);
    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
    res.status(500).json({ error: 'Error al procesar la solicitud.' });
  }
});

// ─── Email Password Recovery ───────────────────────────────────────
// Calls GoTrue POST /auth/v1/recover server-side so real_email never
// reaches the frontend. GoTrue sends the recovery email automatically.

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://akgsylutbpgolurkcavh.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
const publicAppUrl = (process.env.APP_URL || process.env.VITE_SERVER_URL || '').replace(/\/+$/, '');

router.post('/send-reset-email', emailRecoveryLimiter, async (req, res) => {
  const startedAt = Date.now();
  const genericMessage = 'Si la cuenta existe, recibirás instrucciones para recuperar tu contraseña.';

  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Identificador requerido' });

    const cleanId = sanitizeInput(identifier);
    if (cleanId.length < 2) return res.status(400).json({ error: 'Identificador inválido' });

    // Look up profile server-side (RLS bypass via service_role)
    let profile = null;
    const isPhone = /^\d{4,}$/.test(cleanId);

    if (isPhone) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, real_email')
        .eq('phone_digits', cleanId)
        .limit(1);
      profile = data?.[0];
    } else {
      const cleanUsername = cleanId.replace(/^@/, '');
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, real_email')
        .eq('username', cleanUsername)
        .limit(1);
      profile = data?.[0];

      // Fallback: if not found by username, try matching real_email directly
      if (!profile) {
        const emailCandidate = cleanId.toLowerCase().trim();
        const { data: emailData } = await supabaseAdmin
          .from('profiles')
          .select('id, real_email')
          .eq('real_email', emailCandidate)
          .limit(1);
        profile = emailData?.[0];
      }
    }

    // Call GoTrue /recover — sends email if user exists, silent no-op otherwise
    if (profile?.real_email && publicAppUrl) {
      const redirectUrl = `${publicAppUrl}/reset-password`;

      const recoverRes = await fetch(
        `${supabaseUrl}/auth/v1/recover?redirect_to=${encodeURIComponent(redirectUrl)}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json;charset=UTF-8',
            'apikey': supabaseKey,
            'x-supabase-api-version': '2024-01-01',
          },
          body: JSON.stringify({
            email: profile.real_email,
            code_challenge: null,
            code_challenge_method: null,
            gotrue_meta_security: {},
          }),
        },
      );

      if (!recoverRes.ok) {
        const body = await recoverRes.json().catch(() => ({}));
        console.error('[EMAIL-RECOVERY] /recover failed:', recoverRes.status, body?.msg || '');
      }
    }

    // Uniform minimum delay to prevent timing-based enumeration
    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) {
      await new Promise(r => setTimeout(r, 300 - elapsed));
    }

    res.json({ message: genericMessage });
  } catch (err) {
    console.error('[EMAIL-RECOVERY] Error:', err.message || err);
    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) {
      await new Promise(r => setTimeout(r, 300 - elapsed));
    }
    res.status(500).json({ error: 'Error al procesar la solicitud.' });
  }
});

// Step 2: Verify reset code
router.post('/verify-reset-code', verifyLimiter, async (req, res) => {
  const startedAt = Date.now();
  try {
    const { profileId, code } = req.body;
    if (!profileId || !code) return res.status(400).json({ error: 'ID de perfil y código requeridos' });

    const cleanProfileId = sanitizeInput(profileId);
    const cleanCode = sanitizeInput(code).replace(/\D/g, '').slice(0, 6);
    if (cleanCode.length !== 6) return res.status(400).json({ error: 'Código inválido' });

    // Registro activo del perfil (send-reset-code invalida los anteriores,
    // así que a lo sumo hay uno).
    const { record, error } = await loadActiveResetRecord(cleanProfileId);

    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));

    if (error) {
      console.error('[EMAIL-RECOVERY] Verify error:', error);
      return res.status(500).json({ error: 'Error al verificar el código' });
    }

    // Sin registro activo: no existe, expirado, ya usado o bloqueado por intentos.
    if (!record || (record.attempts || 0) >= MAX_RESET_ATTEMPTS) {
      return res.status(400).json({ error: 'Código inválido o expirado' });
    }

    // Código correcto: NO consume intento. El consumo es atómico y de un solo
    // uso en /update-password. No se devuelve el correo completo: la UI no lo
    // necesita (update-password localiza el registro por profile_id).
    if (record.code === cleanCode) {
      return res.json({ message: 'Código verificado' });
    }

    // Código incorrecto: incrementa intentos de forma atómica; al llegar a 5 el
    // código se bloquea. Si la persistencia falla NO se puede continuar como si
    // el intento se hubiera registrado (permitiría eludir el límite).
    const { error: attemptError } = await registerFailedResetAttempt(record);
    if (attemptError) {
      console.error('[EMAIL-RECOVERY] Attempt persist error (verify):', attemptError);
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs < 300) await new Promise(r => setTimeout(r, 300 - elapsedMs));
      return res.status(500).json({ error: 'Error al verificar el código' });
    }

    return res.status(400).json({ error: 'Código inválido o expirado' });
  } catch (err) {
    console.error('[EMAIL-RECOVERY] Verify error:', err);
    res.status(500).json({ error: 'Error al verificar el código' });
  }
});

// Step 3: Update password
router.post('/update-password', verifyLimiter, async (req, res) => {
  const startedAt = Date.now();
  try {
    // `email` ya no se exige: el registro se localiza por profile_id y el correo
    // dejó de devolverse en /verify-reset-code (no es necesario para el flujo).
    const { profileId, code, newPassword } = req.body;
    if (!profileId || !code || !newPassword) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const cleanProfileId = sanitizeInput(profileId);
    const cleanCode = sanitizeInput(code).replace(/\D/g, '').slice(0, 6);

    // Registro activo del perfil. Se localiza por profile_id (no por el código)
    // para que un código incorrecto cuente como intento fallido exactamente
    // igual que en /verify-reset-code y no pueda eludir el límite.
    const { record, error: fetchError } = await loadActiveResetRecord(cleanProfileId);

    if (fetchError) {
      console.error('[EMAIL-RECOVERY] Update lookup error:', fetchError);
      return res.status(500).json({ error: 'Error al actualizar la contraseña' });
    }

    const genericInvalid = () => {
      return res.status(400).json({ error: 'Código inválido o expirado. Solicita uno nuevo.' });
    };

    // Sin registro activo, expirado, ya usado o bloqueado por intentos.
    if (!record || (record.attempts || 0) >= MAX_RESET_ATTEMPTS) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      return genericInvalid();
    }

    // Código incorrecto: cuenta como intento fallido (mismo contador compartido,
    // incremento atómico). Si la persistencia falla, NO se puede continuar como
    // si el intento se hubiera registrado.
    if (record.code !== cleanCode) {
      const { error: attemptError } = await registerFailedResetAttempt(record);
      if (attemptError) {
        console.error('[EMAIL-RECOVERY] Attempt persist error (update):', attemptError);
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs < 300) await new Promise(r => setTimeout(r, 300 - elapsedMs));
        return res.status(500).json({ error: 'Error al actualizar la contraseña' });
      }
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      return genericInvalid();
    }

    // Código correcto: se consume de forma atómica ANTES de cambiar la
    // contraseña. El UPDATE condicional (used=false) garantiza un único uso
    // incluso con solicitudes concurrentes.
    const { consumed, error: claimError } = await consumeResetCode(record.id);
    if (claimError) {
      console.error('[EMAIL-RECOVERY] Consume error:', claimError);
      return res.status(500).json({ error: 'Error al actualizar la contraseña' });
    }
    if (!consumed) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      return genericInvalid();
    }

    // Update password via Supabase Admin API
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      record.profile_id,
      { password: newPassword },
    );

    if (error) {
      console.error('[EMAIL-RECOVERY] Supabase update error:', error);
      return res.status(500).json({ error: 'Error al actualizar la contraseña' });
    }

    console.log(`[EMAIL-RECOVERY] Password updated for profile ${record.profile_id}`);
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('[EMAIL-RECOVERY] Update password error:', err);
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }
});

// ─── Auto-confirm user (DEVELOPMENT ONLY) ─────────────────────────
router.post('/auto-confirm', profileLimiter, async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Endpoint no disponible en producción' });
  }
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requerido' });

    const sanitizedUserId = sanitizeInput(userId);
    if (!/^[0-9a-f-]{36}$/i.test(sanitizedUserId)) {
      return res.status(400).json({ error: 'userId inválido' });
    }

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      sanitizedUserId,
      { email_confirm: true },
    );

    if (error) {
      console.error('[AUTO-CONFIRM] Error:', error);
      return res.status(500).json({ error: 'Error al confirmar usuario' });
    }

    res.json({ message: 'Usuario confirmado' });
  } catch (err) {
    console.error('[AUTO-CONFIRM] Error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Lookup profile by username or phone (for login) ─────────────
router.post('/lookup-profile', profileLimiter, async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Identificador requerido' });

    const cleanId = sanitizeInput(identifier);

    // Try exact username first
    let { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('id, username, name, avatar, avatar_url')
      .eq('username', cleanId);

    if (error) {
      console.error('[LOOKUP-PROFILE] Error:', error);
      return res.status(500).json({ error: 'Error al buscar el usuario' });
    }

    // If not found, try by phone (last 7 digits)
    if (!profiles || profiles.length === 0) {
      const last7 = cleanId.replace(/\D/g, '').slice(-7);
      if (last7.length >= 4) {
        const { data: phoneProfiles } = await supabaseAdmin
          .from('profiles')
.select('id, username, name, avatar, avatar_url')
          .like('phone_digits', `%${last7}`)
          .limit(5);
        profiles = phoneProfiles;
      }
    }

    if (!profiles || profiles.length === 0) {
      return res.status(404).json({ error: 'Usuario o teléfono no encontrado' });
    }

    res.json({ profile: profiles[0] });
  } catch (err) {
    console.error('[LOOKUP-PROFILE] Error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Check duplicate username/phone (for registration) ───────────
router.post('/check-duplicate', profileLimiter, async (req, res) => {
  try {
    const { username, phone } = req.body;
    if (!username && !phone) return res.status(400).json({ error: 'Usuario o teléfono requerido' });

    let result = null;
    if (username) {
      const cleanUsername = sanitizeInput(username);
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('username', cleanUsername)
        .maybeSingle();
      if (data) result = 'username';
    }
    if (!result && phone) {
      const cleanDigits = sanitizeInput(phone).replace(/\D/g, '');
      if (cleanDigits.length > 0) {
        const { data } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('phone_digits', cleanDigits)
          .maybeSingle();
        if (data) result = 'phone';
      }
    }
    res.json({ duplicate: result });
  } catch (err) {
    console.error('[CHECK-DUPLICATE] Error:', err);
    res.status(500).json({ error: 'Error al verificar disponibilidad' });
  }
});

// ─── Upsert profile (for registration) ───────────────────────────
router.post('/upsert-profile', profileLimiter, authMiddleware, async (req, res) => {
  try {
    const profile = req.body;
    if (!profile.id) return res.status(400).json({ error: 'id requerido' });

    // Enforce: user can only upsert their own profile
    if (req.userId !== profile.id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No tienes permiso para modificar este perfil' });
    }

    // Sanitize allowed fields only
    const allowedFields = ['id', 'name', 'username', 'phone_number', 'avatar', 'avatar_url', 'bio', 'status', 'notif_config', 'auto_reply_config'];
    const sanitized = {};
    for (const key of allowedFields) {
      if (profile[key] !== undefined) {
        sanitized[key] = typeof profile[key] === 'string' ? sanitizeInput(profile[key]) : profile[key];
      }
    }

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert(sanitized)
      .select()
      .maybeSingle();

    if (error) {
      console.error('[UPSERT-PROFILE] Error:', error);
      return res.status(500).json({ error: 'Error al crear perfil' });
    }
    res.json({ profile: data });
  } catch (err) {
    console.error('[UPSERT-PROFILE] Error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

export default router;
