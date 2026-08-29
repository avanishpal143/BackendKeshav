import mongoose, { Schema, Document } from 'mongoose';

export interface IActivityLog extends Document {
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
  createdAt: Date;
}

const ActivityLogSchema = new Schema<IActivityLog>(
  {
    actorId:    { type: String, required: true, index: true },
    actorName:  { type: String, required: true },
    actorRole:  { type: String, required: true },
    action:     { type: String, required: true },
    resource:   { type: String, required: true },
    resourceId: String,
    metadata:   Schema.Types.Mixed,
    ipAddress:  String,
  },
  { timestamps: true },
);

ActivityLogSchema.index({ createdAt: -1 });
ActivityLogSchema.index({ resource: 1, resourceId: 1 });

export const ActivityLog = mongoose.model<IActivityLog>('ActivityLog', ActivityLogSchema);
