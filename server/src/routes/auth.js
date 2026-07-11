import { Router } from 'express';
import { supabaseAdmin } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

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

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, 500);
}

// ─── SMS Password Recovery ────────────────────────────────────────

// Step 1: Send reset code via SMS
router.post('/send-reset-code', resetCodeLimiter, async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Teléfono requerido' });

    const cleanPhone = sanitizeInput(phone).replace(/\D/g, '');
    if (cleanPhone.length < 4) return res.status(400).json({ error: 'Teléfono inválido' });

    // Look up profile in Supabase
    const { data: profiles, error } = await supabaseAdmin
      .from('profiles')
      .select('id, phone_number, username')
      .ilike('phone_number', `%${cleanPhone}%`)
      .limit(1);

    if (error) {
      console.error('[SMS-RECOVERY] Supabase lookup error:', error);
      return res.status(500).json({ error: 'Error al buscar el usuario' });
    }

    const profile = profiles?.[0];
    if (!profile) return res.status(404).json({ error: 'No se encontró un usuario con ese teléfono' });

    // Invalidate any previous unused codes for this profile
    await supabaseAdmin
      .from('password_reset_codes')
      .update({ used: true })
      .eq('profile_id', profile.id)
      .eq('used', false);

    // Generate new code (15 min expiry)
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await supabaseAdmin
      .from('password_reset_codes')
      .insert({
        profile_id: profile.id,
        code,
        phone: profile.phone_number,
        expires_at: expiresAt,
      });

    // Mask phone for response
    const maskedPhone = profile.phone_number.length > 4
      ? profile.phone_number.slice(0, -4).replace(/\d/g, '*') + profile.phone_number.slice(-4)
      : profile.phone_number;

    // In production: integrate Twilio/SMS service here
    // For now we log the code server-side only
    console.log(`[SMS-RECOVERY] Code sent to ${maskedPhone}`);

    res.json({
      message: 'Código enviado por SMS',
      maskedPhone,
      expiresIn: 900,
    });
  } catch (err) {
    console.error('[SMS-RECOVERY] Error:', err);
    res.status(500).json({ error: 'Error interno al enviar el código' });
  }
});

// Step 2: Verify reset code
router.post('/verify-reset-code', verifyLimiter, async (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Teléfono y código requeridos' });

    const cleanPhone = sanitizeInput(phone).replace(/\D/g, '');
    const cleanCode = sanitizeInput(code).replace(/\D/g, '');
    const now = new Date().toISOString();

    const { data: records, error } = await supabaseAdmin
      .from('password_reset_codes')
      .select('id, profile_id, expires_at')
      .ilike('phone', `%${cleanPhone}%`)
      .eq('code', cleanCode)
      .eq('used', false)
      .gt('expires_at', now)
      .order('id', { ascending: false })
      .limit(1);

    if (error || !records || records.length === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado' });
    }

    res.json({ message: 'Código verificado', profileId: records[0].profile_id });
  } catch (err) {
    console.error('[SMS-RECOVERY] Verify error:', err);
    res.status(500).json({ error: 'Error al verificar el código' });
  }
});

// Step 3: Update password
router.post('/update-password', verifyLimiter, async (req, res) => {
  try {
    const { phone, code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      return res.status(400).json({ error: 'Teléfono, código y nueva contraseña requeridos' });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    }

    const cleanPhone = sanitizeInput(phone).replace(/\D/g, '');
    const cleanCode = sanitizeInput(code).replace(/\D/g, '');
    const now = new Date().toISOString();

    const { data: records, error: fetchError } = await supabaseAdmin
      .from('password_reset_codes')
      .select('id, profile_id')
      .ilike('phone', `%${cleanPhone}%`)
      .eq('code', cleanCode)
      .eq('used', false)
      .gt('expires_at', now)
      .order('id', { ascending: false })
      .limit(1);

    if (fetchError || !records || records.length === 0) {
      return res.status(400).json({ error: 'Código inválido o expirado. Solicita uno nuevo.' });
    }

    const record = records[0];

    // Update password via Supabase Admin API
    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      record.profile_id,
      { password: newPassword },
    );

    if (error) {
      console.error('[SMS-RECOVERY] Supabase update error:', error);
      return res.status(500).json({ error: 'Error al actualizar la contraseña' });
    }

    // Mark code as used
    await supabaseAdmin
      .from('password_reset_codes')
      .update({ used: true })
      .eq('id', record.id);

    console.log(`[SMS-RECOVERY] Password updated for profile ${record.profile_id}`);
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('[SMS-RECOVERY] Update password error:', err);
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }
});

// ─── Auto-confirm user after registration ──────────────────────────
router.post('/auto-confirm', profileLimiter, async (req, res) => {
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
      .select('id, username, email, name, phone_number, avatar, avatar_url')
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
          .select('id, username, email, name, phone_number, avatar, avatar_url');
        profiles = (phoneProfiles || []).filter((p) => {
          const phoneDigits = (p.phone_number || '').replace(/\D/g, '');
          return phoneDigits.slice(-7) === last7;
        });
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
      const cleanPhone = sanitizeInput(phone);
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone_number', cleanPhone)
        .maybeSingle();
      if (data) result = 'phone';
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
