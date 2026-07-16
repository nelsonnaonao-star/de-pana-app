import { supabaseAdmin } from '../db.js';

export async function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const token = header.slice(7);
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !user) {
      console.error('[AUTH] getUser failed:', error?.message || 'no user');
      return res.status(401).json({ error: 'Token inválido o expirado' });
    }
    req.userId = user.id;
    req.userEmail = user.email;
    req.userRole = user.role;
    next();
  } catch (err) {
    console.error('[AUTH] exception:', err.message);
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
