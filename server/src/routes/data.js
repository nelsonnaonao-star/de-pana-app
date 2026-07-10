import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '..', '..', '..', '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'https://akgsylutbpgolurkcavh.supabase.co';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';
if (!supabaseKey) {
  console.warn('[DATA] SUPABASE_SERVICE_KEY no configurada');
}

const supabaseAdmin = createClient(supabaseUrl, supabaseKey);

const router = Router();

router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[DATA] profile error:', err);
    res.status(500).json(null);
  }
});

router.get('/chats/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('chats')
      .select('*')
      .or(`profile_id.eq.${userId},admin_id.eq.${userId}`)
      .order('updated_at', { ascending: false, nullsFirst: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[DATA] chats error:', err);
    res.json([]);
  }
});

router.get('/contacts/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('contacts')
      .select('*')
      .eq('user_id', userId);
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[DATA] contacts error:', err);
    res.json([]);
  }
});

router.get('/calls/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('calls')
      .select('*')
      .or(`caller_id.eq.${userId},receiver_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[DATA] calls error:', err);
    res.json([]);
  }
});

router.get('/all/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const [profile, chats, contacts, calls] = await Promise.all([
      supabaseAdmin.from('profiles').select('*').eq('id', userId).maybeSingle(),
      supabaseAdmin.from('chats').select('*').or(`profile_id.eq.${userId},admin_id.eq.${userId}`).order('updated_at', { ascending: false, nullsFirst: false }),
      supabaseAdmin.from('contacts').select('*').eq('user_id', userId),
      supabaseAdmin.from('calls').select('*').or(`caller_id.eq.${userId},receiver_id.eq.${userId}`).order('created_at', { ascending: false }),
    ]);
    res.json({
      profile: profile.data,
      chats: chats.data || [],
      contacts: contacts.data || [],
      calls: calls.data || [],
    });
  } catch (err) {
    console.error('[DATA] all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Lookup profile by ID (for QR scanning) ──────────────────────
router.post('/lookup-profile', async (req, res) => {
  try {
    const { userId, username, phone } = req.body;
    if (!userId && !username && !phone) return res.status(400).json({ error: 'userId, username o phone requerido' });

    let query = supabaseAdmin.from('profiles').select('id, name, username, phone_number, avatar, avatar_url, bio');

    if (userId) {
      query = query.eq('id', userId);
    } else if (username) {
      query = query.eq('username', username);
    } else if (phone) {
    const cleanPhone = phone.replace(/\D/g, '').trim();
      const { data: allProfiles, error: allError } = await supabaseAdmin
        .from('profiles')
        .select('id, name, username, phone_number, avatar, avatar_url, bio');
      if (allError) throw allError;
      const match = (allProfiles || []).find((p) => {
        const pd = (p.phone_number || '').replace(/\D/g, '');
        return pd === cleanPhone || pd.slice(-7) === cleanPhone.slice(-7);
      });
      if (!match) return res.status(404).json({ error: 'Usuario no encontrado' });
      return res.json(match);
    }

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.json(data);
  } catch (err) {
    console.error('[DATA] lookup-profile error:', err);
    res.status(500).json({ error: 'Error al buscar perfil' });
  }
});

// ─── Check phone - busca si un número pertenece a un usuario RED ON ─────
router.post('/check-phone', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });

    const cleanPhone = phone.replace(/\D/g, '').trim();

    const { data: allProfiles, error: allError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, username, phone_number, avatar, avatar_url');
    if (allError) throw allError;

    const match = (allProfiles || []).find((p) => {
      const pd = (p.phone_number || '').replace(/\D/g, '');
      return pd === cleanPhone || pd.slice(-10) === cleanPhone.slice(-10);
    });

    if (!match) return res.json({ exists: false });

    res.json({
      exists: true,
      profile: {
        id: match.id,
        name: match.name,
        username: match.username,
        avatar_url: match.avatar || match.avatar_url || '',
      },
    });
  } catch (err) {
    console.error('[DATA] check-phone error:', err);
    res.status(500).json({ error: 'Error al verificar teléfono' });
  }
});

// ─── Create chat ─────────────────────────────────────────────────
router.post('/create-chat', async (req, res) => {
  try {
    const chat = req.body;
    if (!chat.profile_id || !chat.admin_id) return res.status(400).json({ error: 'profile_id y admin_id requeridos' });

    const { data, error } = await supabaseAdmin
      .from('chats')
      .insert({
        name: chat.name || '',
        is_group: chat.is_group || false,
        avatar: chat.avatar || '',
        avatar_color: chat.avatar_color || 'bg-slate-450',
        phone: chat.phone || '',
        username: chat.username || '',
        bio: chat.bio || '',
        profile_id: chat.profile_id,
        admin_id: chat.admin_id,
        is_online: true,
        unread_count: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[DATA] create-chat error:', err);
    res.status(500).json({ error: 'Error al crear chat' });
  }
});

// ─── Add contact ─────────────────────────────────────────────────
router.post('/add-contact', async (req, res) => {
  try {
    const contact = req.body;
    if (!contact.user_id) return res.status(400).json({ error: 'user_id requerido' });
    if (!contact.contact_user_id && !contact.phone) return res.status(400).json({ error: 'contact_user_id o phone requerido' });

    const payload = {
      user_id: contact.user_id,
      name: contact.name || '',
      avatar: contact.avatar || '',
      bio: contact.bio || (contact.phone ? `Contacto externo: ${contact.phone}` : ''),
      type: 'human',
      color_theme: 'from-indigo-500 to-violet-600',
      is_group: false,
      is_favorite: false,
      created_at: new Date().toISOString(),
    };

    if (contact.contact_user_id) {
      payload.contact_user_id = contact.contact_user_id;
    }

    if (contact.phone) {
      payload.phone = contact.phone.replace(/\D/g, '').trim();
    }

    const { data, error } = await supabaseAdmin
      .from('contacts')
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[DATA] add-contact error:', err);
    res.status(500).json({ error: 'Error al agregar contacto' });
  }
});

// ─── Delete chat + all messages + participants ────────────────────
router.delete('/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.query.userId || req.body?.userId;
    if (!chatId) return res.status(400).json({ error: 'chatId requerido' });
    if (!userId) return res.status(400).json({ error: 'userId requerido' });

    // Soft-delete all messages in the chat
    await supabaseAdmin
      .from('messages')
      .update({ is_deleted: true })
      .eq('chat_id', chatId);

    // Remove chat participants
    await supabaseAdmin
      .from('chat_participants')
      .delete()
      .eq('chat_id', chatId);

    // Delete the chat itself
    await supabaseAdmin
      .from('chats')
      .delete()
      .eq('id', chatId);

    res.json({ success: true });
  } catch (err) {
    console.error('[DATA] delete chat error:', err);
    res.status(500).json({ error: 'Error al eliminar chat' });
  }
});

export default router;
