import jwt from 'jsonwebtoken';

const SUPABASE_JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const token = header.slice(7);
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET, { algorithms: ['HS256'] });
    req.userId = decoded.sub;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    console.error('[AUTH] jwt.verify failed:', err.message);
    console.error('[AUTH] Token length:', header.slice(7).length);
    console.error('[AUTH] Secret length:', SUPABASE_JWT_SECRET.length);
    console.error('[AUTH] Secret first4:', SUPABASE_JWT_SECRET.slice(0, 4));
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
