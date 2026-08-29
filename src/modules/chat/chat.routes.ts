import { Router } from 'express';
import { authenticate } from '../../shared/middleware/authenticate.js';
import { ChatMessage } from '../../infrastructure/database/models/ChatMessage.js';
import { success } from '../../shared/response.js';

// In-memory fallback for chat when MongoDB is down
const memMessages: Record<string, Array<{ _id: string; roomId: string; senderId: string; senderName: string; senderRole: string; content: string; type: string; createdAt: string }>> = {};

const router = Router();
router.use(authenticate);

router.get('/:roomId/messages', async (req, res, next) => {
  try {
    const page = Number(req.query.page) || 1;
    const limit = 50;
    let messages;
    try {
      messages = await ChatMessage.find({ roomId: req.params.roomId })
        .sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
      messages = messages.reverse();
    } catch {
      messages = (memMessages[req.params.roomId] ?? []).slice(-limit);
    }
    success(res, messages);
  } catch (err) { next(err); }
});

router.post('/:roomId/messages', async (req, res, next) => {
  try {
    const { content, type, fileUrl, senderName } = req.body;
    const msgData = {
      roomId: req.params.roomId,
      senderId: req.user!.userId,
      senderName: senderName || 'User',
      senderRole: req.user!.role,
      content,
      type: type || 'text',
      fileUrl,
    };
    let msg;
    try {
      msg = await ChatMessage.create(msgData);
    } catch {
      // MongoDB unavailable — use memory
      const memMsg = { _id: Date.now().toString(), ...msgData, createdAt: new Date().toISOString() };
      if (!memMessages[req.params.roomId]) memMessages[req.params.roomId] = [];
      memMessages[req.params.roomId].push(memMsg);
      msg = memMsg;
    }
    success(res, msg, 201);
  } catch (err) { next(err); }
});

router.get('/support/room', async (req, res, next) => {
  try {
    success(res, { roomId: `support-${req.user!.userId}` });
  } catch (err) { next(err); }
});

export default router;
