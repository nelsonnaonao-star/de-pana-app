import { Router } from 'express';
import { supabaseAdmin } from '../db.js';
import { getMessaging } from 'firebase-admin/messaging';

const router = Router();

function sanitizeInput(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim().slice(0, 2000);
}

function mapStoryFromDb(s) {
  return {
    id: s.id,
    user_id: s.user_id,
    type: s.type,
    content: s.type === 'text' ? (s.text || '') : s.type === 'image' ? (s.image_url || '') : (s.video_url || ''),
    created_at: s.created_at,
  };
}

function mapStoryToDb(body) {
  const { user_id, type, content } = body;
  const row = { user_id, type };
  if (type === 'text') row.text = content;
  else if (type === 'image') row.image_url = content;
  else if (type === 'video') row.video_url = content;
  return row;
}

// ─── STORIES ───────────────────────────────────────────────────────

router.get('/stories/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await supabaseAdmin
      .from('stories')
      .select('*')
      .eq('user_id', userId)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json((data || []).map(mapStoryFromDb));
  } catch (err) {
    console.error('[CONTENT] stories get error:', err);
    res.json([]);
  }
});

router.get('/stories', async (req, res) => {
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { data: contacts } = await supabaseAdmin
      .from('contacts')
      .select('contact_user_id')
      .eq('user_id', req.userId);

    const visibleIds = [req.userId];
    if (contacts) {
      for (const c of contacts) {
        if (c.contact_user_id && !visibleIds.includes(c.contact_user_id)) visibleIds.push(c.contact_user_id);
      }
    }

    const { data, error } = await supabaseAdmin
      .from('stories')
      .select('*, profiles!inner(name, avatar_url)')
      .in('user_id', visibleIds)
      .gte('created_at', cutoff)
      .order('created_at', { ascending: false });
    if (error) throw error;
    const mapped = (data || []).map(s => ({
      ...mapStoryFromDb(s),
      profiles: s.profiles ? { name: s.profiles.name, avatar_url: s.profiles.avatar_url } : undefined,
    }));
    res.json(mapped);
  } catch (err) {
    console.error('[CONTENT] all stories error:', err);
    res.json([]);
  }
});

router.post('/stories', async (req, res) => {
  try {
    const { user_id, type } = req.body;
    if (!user_id || !type) {
      return res.status(400).json({ error: 'user_id y type requeridos' });
    }
    if (req.userId !== user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No puedes crear stories como otro usuario' });
    }
    const insertData = mapStoryToDb(req.body);
    const { data, error } = await supabaseAdmin
      .from('stories')
      .insert(insertData)
      .select()
      .single();
    if (error) throw error;
    res.json(mapStoryFromDb(data));
  } catch (err) {
    console.error('[CONTENT] story create error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.delete('/stories/:id', async (req, res) => {
  try {
    const { data: story, error: fetchErr } = await supabaseAdmin
      .from('stories')
      .select('user_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (story && req.userId !== story.user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const { error } = await supabaseAdmin
      .from('stories')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[CONTENT] story delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── STORY VIEWS & REACTIONS ──────────────────────────────────────

router.post('/stories/:storyId/view', async (req, res) => {
  try {
    const { storyId } = req.params;
    const { data: story, error: storyErr } = await supabaseAdmin
      .from('stories')
      .select('user_id')
      .eq('id', storyId)
      .maybeSingle();
    if (storyErr) throw storyErr;
    if (!story) return res.status(404).json({ error: 'Estado no encontrado' });
    if (story.user_id === req.userId) return res.json({ ok: true });
    await supabaseAdmin
      .from('story_views')
      .upsert({ story_id: storyId, viewer_id: req.userId }, { onConflict: 'story_id,viewer_id' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[CONTENT] story view error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.get('/stories/:storyId/viewers', async (req, res) => {
  try {
    const { storyId } = req.params;
    const { data: story, error: storyErr } = await supabaseAdmin
      .from('stories')
      .select('user_id')
      .eq('id', storyId)
      .maybeSingle();
    if (storyErr) throw storyErr;
    if (!story) return res.status(404).json({ error: 'Estado no encontrado' });
    if (story.user_id !== req.userId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const { data: views, error: viewsErr } = await supabaseAdmin
      .from('story_views')
      .select('viewer_id, created_at, profiles!inner(name, avatar_url)')
      .eq('story_id', storyId)
      .order('created_at', { ascending: false });
    if (viewsErr) throw viewsErr;
    const { data: reactions, error: reactErr } = await supabaseAdmin
      .from('story_reactions')
      .select('user_id, reaction_type')
      .eq('story_id', storyId);
    if (reactErr) throw reactErr;
    const reactionMap = {};
    if (reactions) {
      for (const r of reactions) {
        if (!reactionMap[r.user_id]) reactionMap[r.user_id] = [];
        reactionMap[r.user_id].push(r.reaction_type);
      }
    }
    const result = (views || []).map(v => ({
      viewer_id: v.viewer_id,
      name: v.profiles?.name || 'Usuario',
      avatar: v.profiles?.avatar_url || '',
      viewed_at: v.created_at,
      reactions: reactionMap[v.viewer_id] || [],
    }));
    res.json({ viewers: result, total: result.length });
  } catch (err) {
    console.error('[CONTENT] story viewers error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/stories/:storyId/react', async (req, res) => {
  try {
    const { storyId } = req.params;
    const { reaction } = req.body;
    if (!reaction) return res.status(400).json({ error: 'reaction requerida' });
    const { data: existing } = await supabaseAdmin
      .from('story_reactions')
      .select('*')
      .eq('story_id', storyId)
      .eq('user_id', req.userId)
      .maybeSingle();
    if (existing) {
      if (existing.reaction_type === reaction) {
        await supabaseAdmin.from('story_reactions').delete().eq('id', existing.id);
        return res.json({ reacted: false });
      } else {
        await supabaseAdmin.from('story_reactions').update({ reaction_type: reaction }).eq('id', existing.id);
        res.json({ reacted: true, reaction });
      }
    } else {
      await supabaseAdmin.from('story_reactions').insert({ story_id: storyId, user_id: req.userId, reaction_type: reaction });
      res.json({ reacted: true, reaction });

      // Send push notification to story owner (only on new reaction)
      try {
        const { data: story } = await supabaseAdmin
          .from('stories')
          .select('user_id')
          .eq('id', storyId)
          .maybeSingle();
        if (story && story.user_id !== req.userId) {
          const { data: profile } = await supabaseAdmin
            .from('profiles')
            .select('name')
            .eq('id', req.userId)
            .maybeSingle();
          const reactorName = profile?.name || 'Alguien';
          const { data: tokens } = await supabaseAdmin
            .from('push_tokens')
            .select('token, device')
            .eq('profile_id', story.user_id);
          if (tokens?.length) {
            for (const t of tokens) {
              if (t.device === 'android-fcm' || t.device === 'android') {
                try {
                  await getMessaging().send({
                    token: t.token,
                    data: {
                      title: reactorName,
                      body: `Reaccionó ${reaction} a tu estado`,
                      type: 'story_reaction',
                      storyId,
                    },
                    android: { priority: 'high', ttl: 86400000 },
                  });
                } catch {}
              }
            }
          }
        }
      } catch {}
    }
  } catch (err) {
    console.error('[CONTENT] story react error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── BROADCAST CHANNELS ───────────────────────────────────────────

router.get('/channels', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('broadcast_channels')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;

    const { data: subs } = await supabaseAdmin
      .from('broadcast_subscribers')
      .select('channel_id');

    const subCounts = {};
    if (subs) {
      for (const s of subs) {
        subCounts[s.channel_id] = (subCounts[s.channel_id] || 0) + 1;
      }
    }

    const result = (data || []).map(c => ({
      id: c.id,
      name: c.name,
      description: c.description,
      avatar: c.avatar_url || '',
      admin_id: c.admin_id,
      created_at: c.created_at,
      followers: subCounts[c.id] || 0,
    }));
    res.json(result);
  } catch (err) {
    console.error('[CONTENT] channels get error:', err);
    res.json([]);
  }
});

router.get('/channels/:id', async (req, res) => {
  try {
    const { data: channel, error } = await supabaseAdmin
      .from('broadcast_channels')
      .select('*')
      .eq('id', req.params.id)
      .single();
    if (error) throw error;
    if (!channel) return res.status(404).json({ error: 'Canal no encontrado' });

    const { data: messages } = await supabaseAdmin
      .from('broadcast_messages')
      .select('*')
      .eq('channel_id', req.params.id)
      .order('created_at', { ascending: false });

    const messageIds = (messages || []).map(m => m.id);

    let reactionMap = {};
    if (messageIds.length > 0) {
      try {
        const { data: reactions } = await supabaseAdmin
          .from('channel_update_reactions')
          .select('update_id, reaction');
        if (reactions) {
          for (const r of reactions) {
            if (!reactionMap[r.update_id]) {
              reactionMap[r.update_id] = { like: 0, fire: 0, heart: 0 };
            }
            reactionMap[r.update_id][r.reaction] = (reactionMap[r.update_id][r.reaction] || 0) + 1;
          }
        }
      } catch {
        // channel_update_reactions table may not exist yet
      }
    }

    const updates = (messages || []).map(m => ({
      id: m.id,
      text: m.text,
      time: m.created_at ? new Date(m.created_at).toLocaleString() : '',
      reactions: reactionMap[m.id] || { like: 0, fire: 0, heart: 0 },
    }));

    res.json({
      id: channel.id,
      name: channel.name,
      description: channel.description,
      avatar: channel.avatar_url || '',
      admin_id: channel.admin_id,
      created_at: channel.created_at,
      updates,
    });
  } catch (err) {
    console.error('[CONTENT] channel get error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels', async (req, res) => {
  try {
    const { name, description, avatar, created_by } = req.body;
    if (!name || !created_by) {
      return res.status(400).json({ error: 'name y created_by requeridos' });
    }
    if (req.userId !== created_by && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const { data, error } = await supabaseAdmin
      .from('broadcast_channels')
      .insert({ name: sanitizeInput(name), description: sanitizeInput(description || ''), avatar_url: avatar || null, admin_id: created_by })
      .select()
      .single();
    if (error) throw error;

    await supabaseAdmin
      .from('broadcast_subscribers')
      .insert({ channel_id: data.id, user_id: created_by });

    res.json({
      id: data.id,
      name: data.name,
      description: data.description,
      avatar: data.avatar_url || '',
      admin_id: data.admin_id,
      created_at: data.created_at,
      followers: 1,
    });
  } catch (err) {
    console.error('[CONTENT] channel create error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/subscribe', async (req, res) => {
  try {
    const { channel_id, user_id } = req.body;
    if (!channel_id || !user_id) {
      return res.status(400).json({ error: 'channel_id y user_id requeridos' });
    }
    if (req.userId !== user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const { data, error } = await supabaseAdmin
      .from('broadcast_subscribers')
      .upsert({ channel_id, user_id }, { onConflict: 'channel_id,user_id' })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[CONTENT] subscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/unsubscribe', async (req, res) => {
  try {
    const { channel_id, user_id } = req.body;
    if (req.userId !== user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const { error } = await supabaseAdmin
      .from('broadcast_subscribers')
      .delete()
      .eq('channel_id', channel_id)
      .eq('user_id', user_id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[CONTENT] unsubscribe error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/updates', async (req, res) => {
  try {
    const { channel_id, text, user_id } = req.body;
    if (!channel_id || !text) {
      return res.status(400).json({ error: 'channel_id y text requeridos' });
    }

    const posterId = user_id || req.userId;
    if (req.userId !== posterId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const { data: channel, error: chErr } = await supabaseAdmin
      .from('broadcast_channels')
      .select('admin_id')
      .eq('id', channel_id)
      .maybeSingle();
    if (chErr || !channel) return res.status(404).json({ error: 'Canal no encontrado' });

    if (channel.admin_id !== posterId && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'Solo el admin puede publicar en este canal' });
    }

    const { data, error } = await supabaseAdmin
      .from('broadcast_messages')
      .insert({ channel_id, text: sanitizeInput(text) })
      .select()
      .single();
    if (error) throw error;
    res.json({
      id: data.id,
      text: data.text,
      time: data.created_at ? new Date(data.created_at).toLocaleString() : '',
      reactions: { like: 0, fire: 0, heart: 0 },
    });
  } catch (err) {
    console.error('[CONTENT] update create error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/channels/react', async (req, res) => {
  try {
    const { update_id, user_id, reaction } = req.body;
    if (!update_id || !user_id || !reaction) {
      return res.status(400).json({ error: 'update_id, user_id y reaction requeridos' });
    }
    if (req.userId !== user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }

    const { data: existing } = await supabaseAdmin
      .from('channel_update_reactions')
      .select('*')
      .eq('update_id', update_id)
      .eq('user_id', user_id)
      .maybeSingle();

    if (existing) {
      if (existing.reaction === reaction) {
        await supabaseAdmin
          .from('channel_update_reactions')
          .delete()
          .eq('id', existing.id);
        res.json({ reacted: false });
      } else {
        await supabaseAdmin
          .from('channel_update_reactions')
          .update({ reaction })
          .eq('id', existing.id);
        res.json({ reacted: true });
      }
    } else {
      await supabaseAdmin
        .from('channel_update_reactions')
        .insert({ update_id, user_id, reaction });
      res.json({ reacted: true });
    }
  } catch (err) {
    console.error('[CONTENT] react error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── BUSINESS FLYERS ───────────────────────────────────────────────

router.get('/flyers/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { data, error } = await supabaseAdmin
      .from('business_flyers')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[CONTENT] flyers get error:', err);
    res.json([]);
  }
});

router.get('/flyers', async (req, res) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('business_flyers')
      .select('*, profiles!inner(name, avatar_url, phone_number)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    const mapped = (data || []).map(f => ({
      ...f,
      owner_name: f.profiles?.name || '',
      owner_avatar: f.profiles?.avatar_url || '',
      owner_phone: f.profiles?.phone_number || '',
    }));
    res.json(mapped);
  } catch (err) {
    console.error('[CONTENT] all flyers error:', err);
    res.json([]);
  }
});

router.post('/flyers', async (req, res) => {
  try {
    const flyer = req.body;
    if (!flyer.user_id || !flyer.business_name) {
      return res.status(400).json({ error: 'user_id y business_name requeridos' });
    }
    if (req.userId !== flyer.user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const { data, error } = await supabaseAdmin
      .from('business_flyers')
      .insert({
        user_id: flyer.user_id,
        business_name: sanitizeInput(flyer.business_name),
        description: sanitizeInput(flyer.description || ''),
        location: sanitizeInput(flyer.location || ''),
        flyer_url: flyer.flyer_url || '',
        template_id: flyer.template_id || null,
        product_name: sanitizeInput(flyer.product_name || ''),
        price: flyer.price || '',
        music_url: flyer.music_url || '',
        music_name: flyer.music_name || '',
        contact_phone: flyer.contact_phone || '',
        views: 0,
        clicks: 0,
      })
      .select()
      .single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error('[CONTENT] flyer create error:', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/flyers/view/:id', async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('business_flyers')
      .select('views')
      .eq('id', req.params.id)
      .single();
    if (data) {
      await supabaseAdmin
        .from('business_flyers')
        .update({ views: (data.views || 0) + 1 })
        .eq('id', req.params.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[CONTENT] flyer view error:', err);
    res.json({ ok: true });
  }
});

router.post('/flyers/click/:id', async (req, res) => {
  try {
    const { data } = await supabaseAdmin
      .from('business_flyers')
      .select('clicks')
      .eq('id', req.params.id)
      .single();
    if (data) {
      await supabaseAdmin
        .from('business_flyers')
        .update({ clicks: (data.clicks || 0) + 1 })
        .eq('id', req.params.id);
    }
    res.json({ ok: true });
  } catch (err) {
    console.error('[CONTENT] flyer click error:', err);
    res.json({ ok: true });
  }
});

router.delete('/flyers/:id', async (req, res) => {
  try {
    const { data: flyer, error: fetchErr } = await supabaseAdmin
      .from('business_flyers')
      .select('user_id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (flyer && req.userId !== flyer.user_id && req.userRole !== 'service_role') {
      return res.status(403).json({ error: 'No autorizado' });
    }
    const { error } = await supabaseAdmin
      .from('business_flyers')
      .delete()
      .eq('id', req.params.id);
    if (error) throw error;
    res.json({ ok: true });
  } catch (err) {
    console.error('[CONTENT] flyer delete error:', err);
    res.status(500).json({ error: err.message });
  }
});

export default router;
