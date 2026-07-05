import { Router } from 'express';
import { getOne, getAll, run } from '../db.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL || 'https://akgsylutbpgolurkcavh.supabase.co',
  process.env.SUPABASE_SERVICE_KEY || '',
);

const router = Router();

// ─── SMS Password Recovery ────────────────────────────────────────────

function generateCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// Step 1: Send reset code via SMS
router.post('/send-reset-code', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'Teléfono requerido' });

    const cleanPhone = phone.replace(/\D/g, '').trim();
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
    run('UPDATE password_reset_codes SET used = 1 WHERE profile_id = ? AND used = 0', [profile.id]);

    // Generate new code (15 min expiry)
    const code = generateCode();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    run(
      'INSERT INTO password_reset_codes (profile_id, code, phone, expires_at) VALUES (?, ?, ?, ?)',
      [profile.id, code, profile.phone_number, expiresAt],
    );

    // Mask phone for response
    const maskedPhone = profile.phone_number.length > 4
      ? profile.phone_number.slice(0, -4).replace(/\d/g, '*') + profile.phone_number.slice(-4)
      : profile.phone_number;

    console.log(`[SMS-RECOVERY] Code for ${profile.phone_number}: ${code}`);

    // ⚠️ Modo desarrollo: envía el código en la respuesta para mostrarlo en la UI
    // En producción, integrar Twilio y eliminar debugCode
    res.json({
      message: 'Código enviado por SMS',
      maskedPhone,
      expiresIn: 900,
      debugCode: code,
    });
  } catch (err) {
    console.error('[SMS-RECOVERY] Error:', err);
    res.status(500).json({ error: 'Error interno al enviar el código' });
  }
});

// Step 2: Verify reset code
router.post('/verify-reset-code', (req, res) => {
  try {
    const { phone, code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Teléfono y código requeridos' });

    const cleanPhone = phone.replace(/\D/g, '').trim();
    const now = new Date().toISOString();

    const record = getOne(
      `SELECT id, profile_id, expires_at FROM password_reset_codes
       WHERE phone LIKE ? AND code = ? AND used = 0 AND expires_at > ?
       ORDER BY id DESC LIMIT 1`,
      [`%${cleanPhone}%`, code, now],
    );

    if (!record) return res.status(400).json({ error: 'Código inválido o expirado' });

    res.json({ message: 'Código verificado', profileId: record.profile_id });
  } catch (err) {
    console.error('[SMS-RECOVERY] Verify error:', err);
    res.status(500).json({ error: 'Error al verificar el código' });
  }
});

// Step 3: Update password
router.post('/update-password', async (req, res) => {
  try {
    const { phone, code, newPassword } = req.body;
    if (!phone || !code || !newPassword) {
      return res.status(400).json({ error: 'Teléfono, código y nueva contraseña requeridos' });
    }
    if (newPassword.length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres' });
    }

    const cleanPhone = phone.replace(/\D/g, '').trim();
    const now = new Date().toISOString();

    const record = getOne(
      `SELECT id, profile_id FROM password_reset_codes
       WHERE phone LIKE ? AND code = ? AND used = 0 AND expires_at > ?
       ORDER BY id DESC LIMIT 1`,
      [`%${cleanPhone}%`, code, now],
    );

    if (!record) return res.status(400).json({ error: 'Código inválido o expirado. Solicita uno nuevo.' });

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
    run('UPDATE password_reset_codes SET used = 1 WHERE id = ?', [record.id]);

    console.log(`[SMS-RECOVERY] Password updated for profile ${record.profile_id}`);
    res.json({ message: 'Contraseña actualizada correctamente' });
  } catch (err) {
    console.error('[SMS-RECOVERY] Update password error:', err);
    res.status(500).json({ error: 'Error al actualizar la contraseña' });
  }
});

// ─── Auto-confirm user after registration ──────────────────────────
router.post('/auto-confirm', async (req, res) => {
  try {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId requerido' });

    const { error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { email_confirm: true },
    );

    if (error) {
      console.error('[AUTO-CONFIRM] Error:', error);
      return res.status(500).json({ error: 'Error al confirmar usuario' });
    }

    console.log(`[AUTO-CONFIRM] User ${userId} confirmed`);
    res.json({ message: 'Usuario confirmado' });
  } catch (err) {
    console.error('[AUTO-CONFIRM] Error:', err);
    res.status(500).json({ error: 'Error interno' });
  }
});

// ─── Lookup profile by username or phone (for login) ─────────────
router.post('/lookup-profile', async (req, res) => {
  try {
    const { identifier } = req.body;
    if (!identifier) return res.status(400).json({ error: 'Identificador requerido' });

    // Try exact username first
      let { data: profiles, error } = await supabaseAdmin
        .from('profiles')
        .select('id, username, email, name, phone_number, avatar, avatar_url')
        .eq('username', identifier);

    if (error) {
      console.error('[LOOKUP-PROFILE] Error:', error);
      return res.status(500).json({ error: 'Error al buscar el usuario' });
    }

    // If not found, try by phone (last 7 digits)
    if (!profiles || profiles.length === 0) {
      const last7 = identifier.replace(/\D/g, '').slice(-7);
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
router.post('/check-duplicate', async (req, res) => {
  try {
    const { username } = req.body;
    const { phone } = req.body;
    if (!username && !phone) return res.status(400).json({ error: 'Usuario o teléfono requerido' });

    let result = null;
    if (username) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('username', username)
        .maybeSingle();
      if (data) result = 'username';
    }
    if (!result && phone) {
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id')
        .eq('phone_number', phone)
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
router.post('/upsert-profile', async (req, res) => {
  try {
    const profile = req.body;
    if (!profile.id) return res.status(400).json({ error: 'id requerido' });

    const { data, error } = await supabaseAdmin
      .from('profiles')
      .upsert(profile)
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
