import { Router } from 'express';
import { randomInt } from 'crypto';
import { supabaseAdmin } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';
import { sendResetEmail } from '../emailService.js';

const router = Router();

// ─── Rate limiters ────────────────────────────────────────────────
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

function generateCode() {
  return String(randomInt(1000, 10000));
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

    // Uniform response regardless of whether profile exists (no enumeration)
    if (!profile?.real_email) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      return res.json({ message: genericMessage });
    }

    // Invalidate any previous unused codes for this profile
    await supabaseAdmin
      .from('password_reset_codes')
      .update({ used: true })
      .eq('profile_id', profile.id)
      .eq('used', false);

    // Generate new 4-digit code (15 min expiry)
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from('password_reset_codes')
      .insert({
        profile_id: profile.id,
        code,
        phone: profile.real_email,
        expires_at: expiresAt,
      });

    // Mask email for response (e.g. j***@gmail.com)
    const [local, domain] = profile.real_email.split('@');
    const maskedEmail = local
      ? `${local.slice(0, 2)}${local.length > 2 ? '*'.repeat(Math.max(2, local.length - 2)) : '**'}@${domain}`
      : profile.real_email;

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
      expiresIn: 900,
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
    const cleanCode = sanitizeInput(code).replace(/\D/g, '').slice(0, 4);
    if (cleanCode.length !== 4) return res.status(400).json({ error: 'Código inválido' });

    const now = new Date().toISOString();

    const { data: records, error } = await supabaseAdmin
      .from('password_reset_codes')
      .select('id, profile_id, phone, expires_at')
      .eq('profile_id', cleanProfileId)
      .eq('code', cleanCode)
      .eq('used', false)
      .gt('expires_at', now)
      .order('id', { ascending: false })
      .limit(1);

    const elapsed = Date.now() - startedAt;
    if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));

    if (error || !records || records.length === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado' });
    }

    res.json({ message: 'Código verificado', email: records[0].phone });
  } catch (err) {
    console.error('[EMAIL-RECOVERY] Verify error:', err);
    res.status(500).json({ error: 'Error al verificar el código' });
  }
});

// Step 3: Update password
router.post('/update-password', verifyLimiter, async (req, res) => {
  const startedAt = Date.now();
  try {
    const { profileId, email, code, newPassword } = req.body;
    if (!profileId || !email || !code || !newPassword) {
      return res.status(400).json({ error: 'Todos los campos son requeridos' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const cleanProfileId = sanitizeInput(profileId);
    const cleanEmail = sanitizeInput(email).toLowerCase().trim();
    const cleanCode = sanitizeInput(code).replace(/\D/g, '').slice(0, 4);
    const now = new Date().toISOString();

    const { data: records, error: fetchError } = await supabaseAdmin
      .from('password_reset_codes')
      .select('id, profile_id')
      .eq('profile_id', cleanProfileId)
      .eq('phone', cleanEmail)
      .eq('code', cleanCode)
      .eq('used', false)
      .gt('expires_at', now)
      .order('id', { ascending: false })
      .limit(1);

    if (fetchError || !records || records.length === 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      return res.status(400).json({ error: 'Código inválido o expirado. Solicita uno nuevo.' });
    }

    const record = records[0];

    // Update password via Supabase Admin API
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      record.profile_id,
      { password: newPassword },
    );

    if (error) {
      console.error('[EMAIL-RECOVERY] Supabase update error:', error);
      return res.status(500).json({ error: 'Error al actualizar la contraseña' });
    }

    // Mark code as used
    await supabaseAdmin
      .from('password_reset_codes')
      .update({ used: true })
      .eq('id', record.id);

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
