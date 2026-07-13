import { Router } from 'express';
import { supabaseAdmin } from '../db.js';

const router = Router();

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, 500);
}

router.get('/profile/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    if (req.userId !== userId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
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
    if (req.userId !== userId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
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
    if (req.userId !== userId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
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
    if (req.userId !== userId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
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
    if (req.userId !== userId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
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

router.post('/lookup-profile', async (req, res) => {
  try {
    const { userId, username, phone } = req.body;
    if (!userId && !username && !phone) return res.status(400).json({ error: 'userId, username o phone requerido' });

    let query = supabaseAdmin.from('profiles').select('id, name, username, phone_number, avatar, avatar_url, bio');

    if (userId) {
      query = query.eq('id', userId);
    } else if (username) {
      query = query.eq('username', sanitizeInput(username));
    } else if (phone) {
      const cleanPhone = phone.replace(/\D/g, '').trim();
      const { data: match, error: matchError } = await supabaseAdmin
        .from('profiles')
        .select('id, name, username, phone_number, avatar, avatar_url, bio')
        .eq('phone_digits', cleanPhone)
        .maybeSingle();
      if (matchError) throw matchError;
      if (!match) {
        const last7 = cleanPhone.slice(-7);
        const { data: match7 } = await supabaseAdmin
          .from('profiles')
          .select('id, name, username, phone_number, avatar, avatar_url, bio')
          .like('phone_digits', `%${last7}`)
          .limit(1)
          .maybeSingle();
        if (!match7) return res.status(404).json({ error: 'Usuario no encontrado' });
        return res.json(match7);
      }
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

router.post('/check-phone', async (req, res) => {
  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ error: 'phone requerido' });

    const cleanPhone = phone.replace(/\D/g, '').trim();

    const { data: match, error: matchError } = await supabaseAdmin
      .from('profiles')
      .select('id, name, username, phone_number, avatar, avatar_url')
      .eq('phone_digits', cleanPhone)
      .maybeSingle();
    if (matchError) throw matchError;

    const found = match || await (async () => {
      const last10 = cleanPhone.slice(-10);
      const { data } = await supabaseAdmin
        .from('profiles')
        .select('id, name, username, phone_number, avatar, avatar_url')
        .like('phone_digits', `%${last10}`)
        .limit(1)
        .maybeSingle();
      return data;
    })();

    if (!found) return res.json({ exists: false });

    res.json({
      exists: true,
      profile: {
        id: found.id,
        name: found.name,
        username: found.username,
        avatar_url: found.avatar || found.avatar_url || '',
      },
    });
  } catch (err) {
    console.error('[DATA] check-phone error:', err);
    res.status(500).json({ error: 'Error al verificar teléfono' });
  }
});

router.post('/create-chat', async (req, res) => {
  try {
    const chat = req.body;
    if (!chat.profile_id || !chat.admin_id) return res.status(400).json({ error: 'profile_id y admin_id requeridos' });

    if (req.userId !== chat.admin_id && req.userId !== chat.profile_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado para crear este chat' });
    }

    const { data, error } = await supabaseAdmin
      .from('chats')
      .insert({
        name: sanitizeInput(chat.name || ''),
        is_group: chat.is_group || false,
        avatar: chat.avatar || '',
        avatar_color: chat.avatar_color || 'bg-slate-450',
        phone: chat.phone || '',
        username: sanitizeInput(chat.username || ''),
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

router.post('/add-contact', async (req, res) => {
  try {
    const contact = req.body;
    if (!contact.user_id) return res.status(400).json({ error: 'user_id requerido' });
    if (!contact.contact_user_id && !contact.phone) return res.status(400).json({ error: 'contact_user_id o phone requerido' });

    if (req.userId !== contact.user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const payload = {
      user_id: contact.user_id,
      name: sanitizeInput(contact.name || ''),
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

router.delete('/chats/:chatId', async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.userId;
    if (!chatId) return res.status(400).json({ error: 'chatId requerido' });

    const { data: chat, error: chatError } = await supabaseAdmin
      .from('chats')
      .select('profile_id, admin_id')
      .eq('id', chatId)
      .maybeSingle();
    if (chatError || !chat) return res.status(404).json({ error: 'Chat no encontrado' });

    if (req.userId !== chat.profile_id && req.userId !== chat.admin_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado para eliminar este chat' });
    }

    await supabaseAdmin
      .from('messages')
      .update({ is_deleted: true })
      .eq('chat_id', chatId);

    await supabaseAdmin
      .from('chat_participants')
      .delete()
      .eq('chat_id', chatId);

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
