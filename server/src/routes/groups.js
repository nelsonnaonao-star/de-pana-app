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

// POST /api/groups/sound
// Body: { chat_id: string, sound_id: string | null }
// Guarda el sonido de notificación personalizado para un grupo.
// null = volver al sonido global.
router.post('/sound', async (req, res) => {
  try {
    const { chat_id, sound_id } = req.body;
    if (!chat_id) {
      return res.status(400).json({ ok: false, error: 'chat_id requerido' });
    }

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id, is_group, profile_id, admin_id')
      .eq('id', chat_id)
      .single();
    if (!chat) {
      return res.status(404).json({ ok: false, error: 'Chat no encontrado' });
    }

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

    const { error } = await supabaseAdmin
      .from('chats')
      .update({ notification_sound: sound_id || null, updated_at: new Date().toISOString() })
      .eq('id', chat_id);

    if (error) {
      console.error('[GROUPS] sound update error:', error);
      return res.status(500).json({ ok: false, error: error.message });
    }

    res.json({ ok: true, notification_sound: sound_id || null });
  } catch (err) {
    console.error('[GROUPS] sound error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// POST /api/groups/remove-participant
// Remove one member from a group chat and notify everyone via system message.
// Body: { chat_id: string, profile_id: string }
// The endpoint is responsible for inserting a group_member_events row so the
// removed user's device can purge the chat locally via Realtime.
router.post('/remove-participant', async (req, res) => {
  try {
    const { chat_id, profile_id } = req.body || {};
    if (!chat_id || !profile_id) {
      return res.status(400).json({ ok: false, error: 'chat_id y profile_id requeridos' });
    }

    const { data: chat } = await supabaseAdmin
      .from('chats')
      .select('id, is_group, admin_id')
      .eq('id', chat_id)
      .maybeSingle();
    if (!chat) {
      return res.status(404).json({ ok: false, error: 'Grupo no encontrado' });
    }
    if (!chat.is_group) {
      return res.status(400).json({ ok: false, error: 'Solo se pueden expulsar miembros de chats grupales' });
    }
    if (chat.admin_id !== req.userId && req.userRole !== 'service_role') {
      console.log('[GROUPS] remove-participant forbidden', { chat_id, target: profile_id, admin_id: chat.admin_id, caller: req.userId });
      return res.status(403).json({ ok: false, error: 'Solo el admin del grupo puede expulsar miembros' });
    }

    // 1) Borrar participante (crítica)
    const { error: delErr } = await supabaseAdmin
      .from('chat_participants')
      .delete()
      .eq('chat_id', chat_id)
      .eq('profile_id', profile_id);
    if (delErr) {
      console.error('[GROUPS] remove-participant delete error:', delErr);
      return res.status(500).json({ ok: false, error: delErr.message });
    }

    // 2) Evento de Realtime dirigido al expulsado (crítica)
    const { error: evErr } = await supabaseAdmin
      .from('group_member_events')
      .insert({ user_id: profile_id, chat_id, type: 'removed' });
    if (evErr) {
      console.error('[GROUPS] remove-participant event insert error:', evErr);
      return res.status(500).json({ ok: false, error: evErr.message });
    }

    // 3) Mensaje de sistema para el resto del grupo
    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('name')
      .eq('id', profile_id)
      .maybeSingle();
    const memberName = profile?.name || 'Usuario';
    const systemText = `👋 ${memberName} fue eliminado del grupo`;
    try {
      await supabaseAdmin.from('messages').insert({
        chat_id,
        sender_id: req.userId,
        text: systemText,
        type: 'system',
        status: 'sent',
        created_at: new Date().toISOString(),
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
      });
      await supabaseAdmin
        .from('chats')
        .update({
          last_message: systemText,
          last_message_time: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', chat_id);
    } catch (msgErr) {
      // El mensaje de sistema es best-effort; la purga y el borrado ya ocurrieron.
      console.error('[GROUPS] remove-participant system message error:', msgErr);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[GROUPS] remove-participant error:', err);
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

    // Emitir evento 'added' SOLO a los miembros realmente nuevos (el upsert
    // con ignoreDuplicates no informa cuáles se ignoraron, así que se consulta).
    // Es best-effort: si falla, el chat igual se agrega por el INSERT realtime.
    try {
      const { data: existing } = await supabaseAdmin
        .from('chat_participants')
        .select('profile_id')
        .eq('chat_id', chat_id);
      const existingIds = new Set((existing || []).map(r => r.profile_id));
      const freshIds = member_ids.filter(id => !existingIds.has(id));
      if (freshIds.length > 0) {
        await supabaseAdmin.from('group_member_events').insert(
          freshIds.map(profile_id => ({ user_id: profile_id, chat_id, type: 'added' }))
        );
      }
    } catch (eventErr) {
      console.error('[GROUPS] add-participants event insert error:', eventErr);
    }

    res.json({ ok: true, inserted: member_ids.length });
  } catch (err) {
    console.error('[GROUPS] add-participants error:', err);
    res.status(500).json({ ok: false, error: err.message });
  }
});

export default router;
