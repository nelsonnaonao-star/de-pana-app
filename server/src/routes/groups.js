import { Router } from 'express';
import { supabaseAdmin } from '../db.js';

const router = Router();

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
      .select('id, is_group')
      .eq('id', chat_id)
      .single();
    if (!chat) {
      return res.status(404).json({ ok: false, error: 'Chat not found' });
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
