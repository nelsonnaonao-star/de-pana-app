import { Router } from 'express';
import { supabaseAdmin } from '../db.js';

const router = Router();

// ─── Mute helpers ───────────────────────────────────────────────────
// Retorna true si el grupo está silenciado y la mute sigue activa
// (muted_until NULL = "Siempre" mientras active; si no, hasta la fecha).
export async function isGroupMuted(chatId) {
  try {
    const { data, error } = await supabaseAdmin
      .from('chat_mutes')
      .select('active, muted_until')
      .eq('chat_id', chatId)
      .maybeSingle();
    if (error || !data) return false;
    if (!data.active) return false;
    if (!data.muted_until) return true; // Siempre
    return new Date(data.muted_until).getTime() > Date.now();
  } catch {
    return false;
  }
}

// POST /api/groups/mute
// Body: { chat_id: string, duration: "8h" | "12h" | "24h" | "always" }
router.post('/mute', async (req, res) => {
  try {
    const { chat_id, duration } = req.body;
    if (!chat_id || !duration) {
      return res.status(400).json({ ok: false, error: 'chat_id y duration requeridos' });
    }

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id, is_group, profile_id, admin_id')
      .eq('id', chat_id)
      .single();
    if (!chat) {
      return res.status(404).json({ ok: false, error: 'Chat no encontrado' });
    }

    // Autorización: solo un participante del chat puede silenciarlo (o un
    // service_role). Un usuario ajeno no puede mutear un grupo que no es suyo.
    const isDirectParticipant = chat.profile_id === req.userId || chat.admin_id === req.userId;
    const { data: participant } = await supabaseAdmin
      .from('chat_participants')
      .select('profile_id')
      .eq('chat_id', chat_id)
      .eq('profile_id', req.userId)
      .maybeSingle();
    if (!isDirectParticipant && !participant && req.userRole !== 'service_role') {
      return res.status(403).json({ ok: false, error: 'No eres miembro de este grupo' });
    }

    const hours = { '8h': 8, '12h': 12, '24h': 24 };
    const muted_until = duration === 'always'
      ? null
      : new Date(Date.now() + (hours[duration] || 24) * 3600 * 1000).toISOString();

    const { error } = await supabaseAdmin
      .from('chat_mutes')
      .upsert({
        chat_id,
        active: true,
        muted_until,
        muted_by: req.userId || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'chat_id' });

    if (error) {
      console.error('[GROUPS] mute upsert error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({ ok: true, muted_until });
  } catch (err) {
    console.error('[GROUPS] mute error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/groups/unmute
// Body: { chat_id: string }
router.post('/unmute', async (req, res) => {
  try {
    const { chat_id } = req.body;
    if (!chat_id) {
      return res.status(400).json({ ok: false, error: 'chat_id requerido' });
    }

    const { error } = await supabaseAdmin
      .from('chat_mutes')
      .upsert({
        chat_id,
        active: false,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'chat_id' });

    if (error) {
      console.error('[GROUPS] unmute upsert error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[GROUPS] unmute error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// GET /api/groups/mute/:chat_id
// Retorna el estado actual de silencio del grupo.
router.get('/mute/:chat_id', async (req, res) => {
  try {
    const { chat_id } = req.params;
    const { data, error } = await supabaseAdmin
      .from('chat_mutes')
      .select('active, muted_until')
      .eq('chat_id', chat_id)
      .maybeSingle();
    if (error) {
      return res.status(500).json({ ok: false, error: error.message });
    }
    const isMuted = !!data && data.active
      && (!data.muted_until || new Date(data.muted_until).getTime() > Date.now());
    res.json({ ok: true, isMuted, muted_until: data?.muted_until || null });
  } catch (err) {
    console.error('[GROUPS] get mute error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/groups/add-participants
// Insert multiple participants into a group chat using service_role (bypasses RLS)
// Body: { chat_id: string, member_ids: string[] }
router.post('/add-participants', async (req, res) => {
  try {
    const { chat_id, member_ids } = req.body;
    if (!chat_id || !member_ids || !Array.isArray(member_ids) || member_ids.length === 0) {
      return res.status(400).json({ ok: false, error: 'chat_id and member_ids (array) required' });
    }

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id, is_group, admin_id')
      .eq('id', chat_id)
      .single();
    if (!chat) {
      return res.status(404).json({ ok: false, error: 'Chat not found' });
    }
    if (!chat.is_group) {
      return res.status(400).json({ ok: false, error: 'Solo se pueden agregar participantes a chats grupales' });
    }
    if (chat.admin_id !== req.userId && req.userRole !== 'service_role') {
      return res.status(403).json({ ok: false, error: 'Solo el admin del grupo puede agregar participantes' });
    }

    const rows = member_ids.map(profile_id => ({ chat_id, profile_id }));
    const { error } = await supabaseAdmin
      .from('chat_participants')
      .upsert(rows, { onConflict: 'chat_id,profile_id', ignoreDuplicates: true });

    if (error) {
      console.error('[GROUPS] add-participants upsert error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({ ok: true, inserted: member_ids.length });
  } catch (err) {
    console.error('[GROUPS] add-participants error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
