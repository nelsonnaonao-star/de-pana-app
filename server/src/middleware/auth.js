import jwt from 'jsonwebtoken';

const RAW_SECRET = process.env.SUPABASE_JWT_SECRET || '';
// Supabase stores JWT secret as base64-encoded bytes.
// jwt.verify() needs the raw decoded bytes for HMAC comparison.
const SECRET_BUFFER = Buffer.from(RAW_SECRET, 'base64');

export function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token requerido' });
  }
  try {
    const token = header.slice(7);
    // Try base64-decoded secret first (Supabase default), fallback to raw string
    let decoded;
    try {
      decoded = jwt.verify(token, SECRET_BUFFER, { algorithms: ['HS256'] });
    } catch {
      decoded = jwt.verify(token, RAW_SECRET, { algorithms: ['HS256'] });
    }
    req.userId = decoded.sub;
    req.userEmail = decoded.email;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    console.error('[AUTH] jwt.verify failed:', err.message, '| Secret len:', RAW_SECRET.length, '| Secret first4:', RAW_SECRET.slice(0, 4));
    return res.status(401).json({ error: 'Token inválido o expirado' });
  }
}
