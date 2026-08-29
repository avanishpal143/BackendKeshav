import { Server as HttpServer } from 'http';
import { Server as SocketServer, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { logger } from '../../shared/logger.js';
import { AuthPayload } from '../../shared/middleware/authenticate.js';

let io: SocketServer | null = null;

export function initSocketServer(server: HttpServer) {
  io = new SocketServer(server, {
    cors: {
      origin: process.env.APP_ORIGIN || 'http://localhost:5173',
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // Auth middleware for socket
  io.use((socket: Socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) return next(new Error('No token'));
    try {
      const payload = jwt.verify(
        token,
        process.env.JWT_ACCESS_SECRET || 'dev-secret',
      ) as AuthPayload;
      (socket as Socket & { user: AuthPayload }).user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as Socket & { user?: AuthPayload }).user;
    logger.info(`Socket connected: ${socket.id} user=${user?.userId}`);

    if (user?.userId) {
      socket.join(`user:${user.userId}`);
    }
    if (user?.role === 'super_admin' || user?.role === 'state_admin') {
      socket.join('admin-room');
    }

    socket.on('join-district', (district: string) => {
      socket.join(`district:${district}`);
    });

    socket.on('disconnect', () => {
      logger.debug(`Socket disconnected: ${socket.id}`);
    });
  });

  logger.info('✅ Socket.IO server initialized');
  return io;
}

export function getIO(): SocketServer {
  if (!io) throw new Error('Socket.IO not initialized');
  return io;
}

// Emit helpers
export function emitToUser(userId: string, event: string, data: unknown) {
  getIO().to(`user:${userId}`).emit(event, data);
}

export function emitToAdmins(event: string, data: unknown) {
  getIO().to('admin-room').emit(event, data);
}

export function emitToDistrict(district: string, event: string, data: unknown) {
  getIO().to(`district:${district}`).emit(event, data);
}

export function broadcast(event: string, data: unknown) {
  getIO().emit(event, data);
}
