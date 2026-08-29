import mongoose, { Schema, Document } from 'mongoose';

export interface ICommunityFeed extends Document {
  authorId: string;
  authorName: string;
  content: string;
  imageUrls: string[];
  likes: string[];
  district?: string;
  pinned: boolean;
  createdAt: Date;
}

const CommunityFeedSchema = new Schema<ICommunityFeed>(
  {
    authorId:   { type: String, required: true, index: true },
    authorName: { type: String, required: true },
    content:    { type: String, required: true },
    imageUrls:  [String],
    likes:      [String],
    district:   String,
    pinned:     { type: Boolean, default: false },
  },
  { timestamps: true },
);

CommunityFeedSchema.index({ createdAt: -1 });
CommunityFeedSchema.index({ district: 1 });

export const CommunityFeed = mongoose.model<ICommunityFeed>('CommunityFeed', CommunityFeedSchema);
