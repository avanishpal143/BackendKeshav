import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../shared/logger.js';

let s3Client: S3Client | null = null;

function getEnv() {
  return {
    accountId: process.env.CLOUDFLARE_R2_ACCOUNT_ID || '',
    accessKey: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID || '',
    secretKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || '',
    bucket: process.env.CLOUDFLARE_R2_BUCKET || 'community-connect',
    publicUrl: process.env.CLOUDFLARE_R2_PUBLIC_URL || '',
  };
}

function getClient(): S3Client | null {
  if (s3Client) return s3Client;
  const { accountId, accessKey, secretKey } = getEnv();
  if (!accountId || !accessKey || !secretKey) {
    logger.warn('R2: Missing credentials — file upload disabled');
    return null;
  }
  s3Client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: accessKey,
      secretAccessKey: secretKey,
    },
  });
  logger.info('Cloudflare R2 storage initialized');
  return s3Client;
}

function getPublicUrl(): string {
  const { publicUrl, accountId } = getEnv();
  return publicUrl || `https://pub-${accountId}.r2.dev`;
}

function getBucket(): string {
  return getEnv().bucket;
}

/**
 * Upload a file buffer to R2 and return the public URL.
 * @param buffer File buffer
 * @param originalName Original filename (for extension)
 * @param folder Folder path in bucket (e.g. 'posts', 'avatars')
 * @param contentType MIME type
 */
export async function uploadToR2(
  buffer: Buffer,
  originalName: string,
  folder: string = 'uploads',
  contentType: string = 'application/octet-stream',
): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const ext = originalName.split('.').pop() || 'bin';
  const key = `${folder}/${uuidv4()}.${ext}`;

  try {
    await client.send(new PutObjectCommand({
      Bucket: getBucket(),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }));

    const url = `${getPublicUrl()}/${key}`;
    logger.info(`R2: Uploaded ${key} (${(buffer.length / 1024).toFixed(1)}KB)`);
    return url;
  } catch (err: any) {
    logger.error(`R2: Upload failed — ${err.message}`);
    return null;
  }
}

/**
 * Upload base64 data URL to R2.
 * Handles "data:image/jpeg;base64,..." format.
 */
export async function uploadBase64ToR2(
  dataUrl: string,
  folder: string = 'uploads',
): Promise<string | null> {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;

  const matches = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!matches) return null;

  const contentType = matches[1];
  const buffer = Buffer.from(matches[2], 'base64');
  const ext = contentType.split('/')[1]?.replace('jpeg', 'jpg') || 'bin';

  return uploadToR2(buffer, `file.${ext}`, folder, contentType);
}

/**
 * Delete a file from R2 by its public URL.
 */
export async function deleteFromR2(publicUrl: string): Promise<void> {
  const client = getClient();
  if (!client || !publicUrl) return;

  const key = publicUrl.replace(`${getPublicUrl()}/`, '');
  try {
    await client.send(new DeleteObjectCommand({ Bucket: getBucket(), Key: key }));
    logger.info(`R2: Deleted ${key}`);
  } catch (err: any) {
    logger.warn(`R2: Delete failed — ${err.message}`);
  }
}

export function isR2Configured(): boolean {
  const { accountId, accessKey, secretKey } = getEnv();
  return Boolean(accountId && accessKey && secretKey);
}
