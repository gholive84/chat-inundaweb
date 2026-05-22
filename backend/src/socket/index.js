const jwt = require('jsonwebtoken');

module.exports = function initSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('no token'));
    try {
      const u = jwt.verify(token, process.env.JWT_SECRET);
      socket.user = u;
      next();
    } catch { next(new Error('invalid token')); }
  });

  io.on('connection', (socket) => {
    const { id, companyId, name, type } = socket.user || {};
    if (!companyId) return socket.disconnect();
    socket.join(`company:${companyId}`);
    socket.join(`user:${id}`);
    console.log(`socket connected: ${name} (${type})`);

    socket.on('join_conversation', ({ conversationId }) => {
      socket.join(`conv:${conversationId}`);
    });
    socket.on('leave_conversation', ({ conversationId }) => {
      socket.leave(`conv:${conversationId}`);
    });

    // Agente está digitando — broadcast pra outros agentes e dispara pausa da IA
    socket.on('agent_typing', ({ conversationId }) => {
      socket.to(`company:${companyId}`).emit('agent_typing', { conversationId, userId: id });
    });

    socket.on('disconnect', () => {
      console.log(`socket disconnected: ${name}`);
    });
  });
};
