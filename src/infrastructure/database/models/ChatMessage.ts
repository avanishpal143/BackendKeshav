import mongoose, { Schema, Document } from 'mongoose';

export interface IChatMessage extends Document {
  roomId: string;
  senderId: string;
  senderName: string;
  senderRole: string;
  content: string;
  type: 'text' | 'image' | 'file';
  fileUrl?: string;
  isRead: boolean;
  createdAt: Date;
}

const ChatMessageSchema = new Schema<IChatMessage>(
  {
    roomId:      { type: String, required: true, index: true },
    senderId:    { type: String, required: true },
    senderName:  { type: String, required: true },
    senderRole:  { type: String, default: 'user' },
    content:     { type: String, required: true },
    type:        { type: String, enum: ['text', 'image', 'file'], default: 'text' },
    fileUrl:     String,
    isRead:      { type: Boolean, default: false },
  },
  { timestamps: true },
);

ChatMessageSchema.index({ roomId: 1, createdAt: -1 });

export const ChatMessage = mongoose.model<IChatMessage>('ChatMessage', ChatMessageSchema);
