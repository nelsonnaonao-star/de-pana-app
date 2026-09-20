import { Router } from 'express';
import { supabaseAdmin } from '../db.js';
import { authMiddleware } from '../middleware/auth.js';

const router = Router();

const MEDIA_TYPES = ['image', 'video', 'audio', 'file', 'sticker'];
const VALID_ADMIN_ROLES = ['owner', 'admin', 'viewer'];
const DAYS_WINDOW = 30;

router.use(authMiddleware);

async function requireAdmin(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('admins')
      .select('user_id, role')
      .eq('user_id', req.userId)
      .maybeSingle();

    if (error) throw error;
    if (!data || !VALID_ADMIN_ROLES.includes(data.role)) {
      return res.status(403).json({ error: 'Se requieren permisos de administración' });
    }
    req.adminRole = data.role;
    next();
  } catch (err) {
    console.error('[ADMIN] requireAdmin:', err.message);
    res.status(500).json({ error: 'Error interno al verificar permisos' });
  }
}

router.use(requireAdmin);

// Mensajes vigentes = misma regla que WEPA móvil:
//   is_deleted NULL|false  Y  efímeros no expirados.
function activeMessagesQuery() {
  return supabaseAdmin
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .or('is_deleted.is.null,is_deleted.eq.false')
    .or(`ephemeral_expires_at.is.null,ephemeral_expires_at.gt.${new Date().toISOString()}`);
}

function countMessages(filters = {}) {
  let query = activeMessagesQuery();
  if (filters.type) query = query.eq('type', filters.type);
  if (filters.media) query = query.in('type', MEDIA_TYPES);
  if (filters.since) query = query.gte('created_at', filters.since);
  return query.then(({ count, error }) => {
    if (error) throw error;
    return count || 0;
  });
}

function countChats(groupsOnly = false) {
  let query = supabaseAdmin
    .from('chats')
    .select('*', { count: 'exact', head: true })
    .is('deleted_at', null);
  if (groupsOnly) query = query.eq('is_group', true);
  return query.then(({ count, error }) => {
    if (error) throw error;
    return count || 0;
  });
}

router.get('/stats/messaging', async (_req, res) => {
  try {
    const since = new Date(Date.now() - DAYS_WINDOW * 86400000).toISOString();
    const [totalMessages, recentMessages, activeConversations, mediaCount, voiceNotes, groups] =
      await Promise.all([
        countMessages(),
        countMessages({ since }),
        countChats(false),
        countMessages({ media: true }),
        countMessages({ type: 'voice_note' }),
        countChats(true),
      ]);

    res.json({
      totalMessages,
      dailyAverage: Math.round(recentMessages / DAYS_WINDOW),
      activeConversations,
      mediaCount,
      voiceNotes,
      groups,
    });
  } catch (err) {
    console.error('[ADMIN] stats/messaging:', err.message);
    res.status(500).json({ error: 'Error al obtener estadísticas de mensajería' });
  }
});

router.get('/stats/messaging/volume', async (req, res) => {
  const days = Math.min(Math.max(parseInt(req.query.days, 10) || 14, 1), 90);
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_messaging_volume', { days });
    if (error) throw error;

    res.json((data || []).map((r) => ({
      label: new Intl.DateTimeFormat('es-EC', { day: '2-digit', month: 'short', timeZone: 'UTC' })
        .format(new Date(`${r.day}T00:00:00Z`))
        .replace('.', ''),
      valueA: Number(r.messages) || 0,
      valueB: Number(r.media) || 0,
      valueC: Number(r.voice) || 0,
    })));
  } catch (err) {
    console.error('[ADMIN] volume:', err.message);
    res.status(500).json({ error: 'Error al obtener el volumen de mensajes' });
  }
});

router.get('/stats/messaging/hourly', async (_req, res) => {
  try {
    const { data, error } = await supabaseAdmin.rpc('admin_messaging_hourly');
    if (error) throw error;

    const byHour = new Map((data || []).map((r) => [Number(r.hour), Number(r.count) || 0]));
    res.json(Array.from({ length: 24 }, (_, h) => ({
      label: String(h).padStart(2, '0'),
      value: byHour.get(h) || 0,
    })));
  } catch (err) {
    console.error('[ADMIN] hourly:', err.message);
    res.status(500).json({ error: 'Error al obtener la distribución horaria' });
  }
});

router.get('/users', async (req, res) => {
  const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 500, 1), 1000);
  const offset = Math.max(parseInt(req.query.offset, 10) || 0, 0);
  try {
    const { data, error } = await supabaseAdmin
      .from('profiles')
      .select('id, name, display_name, username, phone_number, phone_digits, avatar, avatar_url, real_email, email, status, role, last_active, created_at')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[ADMIN] users:', err.message);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
});

export default router;