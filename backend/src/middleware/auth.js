const jwt = require('jsonwebtoken');

function decode(req) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  try { return jwt.verify(h.slice(7), process.env.JWT_SECRET); }
  catch { return null; }
}

function authCompany(req, res, next) {
  const u = decode(req);
  if (!u || u.type !== 'agent') return res.status(401).json({ error: 'Não autorizado' });
  req.user = u; // { id, companyId, role, name, email, type:'agent' }
  next();
}

function authRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Permissão insuficiente' });
    }
    next();
  };
}

module.exports = { authCompany, authRole };
