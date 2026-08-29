/**
 * Firebase Cloud Messaging (FCM) — Push Notification Service
 * 
 * Setup:
 * 1. Go to Firebase Console → Project Settings → Service Accounts
 * 2. Click "Generate new private key" → download the JSON file
 * 3. Set FIREBASE_SERVICE_ACCOUNT_PATH in .env to the path of the file
 *    OR set FIREBASE_SERVICE_ACCOUNT_JSON to the JSON content directly
 */
import admin from 'firebase-admin';
import path from 'path';
import fs from 'fs';
import { logger } from '../../shared/logger.js';

let initialized = false;

export function initFirebase() {
  if (initialized) return;

  try {
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

    if (serviceAccountJson) {
      const serviceAccount = JSON.parse(serviceAccountJson);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      initialized = true;
      logger.info('✅ Firebase Admin initialized (from JSON env)');
    } else if (serviceAccountPath) {
      const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
      const fileContent = fs.readFileSync(resolvedPath, 'utf-8');
      const serviceAccount = JSON.parse(fileContent);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      initialized = true;
      logger.info('✅ Firebase Admin initialized (from file)');
    } else {
      logger.warn('Firebase: No service account configured — push notifications disabled');
      logger.warn('   Set FIREBASE_SERVICE_ACCOUNT_PATH or FIREBASE_SERVICE_ACCOUNT_JSON in .env');
    }
  } catch (err) {
    logger.warn('Firebase: initialization failed —', err);
  }
}

/**
 * Send push notification to a single device
 */
export async function sendPushToDevice(fcmToken: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  if (!initialized) return false;

  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body },
      data: data ?? {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'high_importance',
        },
      },
    });
    return true;
  } catch (err: any) {
    if (err.code === 'messaging/registration-token-not-registered') {
      logger.warn(`FCM: Token expired/invalid — ${fcmToken.slice(0, 20)}...`);
    } else {
      logger.error('FCM send error:', err.message);
    }
    return false;
  }
}

/**
 * Send push notification to multiple devices
 */
export async function sendPushToDevices(fcmTokens: string[], title: string, body: string, data?: Record<string, string>): Promise<number> {
  if (!initialized || fcmTokens.length === 0) return 0;

  try {
    const message = {
      notification: { title, body },
      data: data ?? {},
      android: {
        priority: 'high' as const,
        notification: {
          sound: 'default',
          channelId: 'high_importance',
        },
      },
    };

    let successCount = 0;
    // Send in batches of 500 (FCM limit)
    for (let i = 0; i < fcmTokens.length; i += 500) {
      const batch = fcmTokens.slice(i, i + 500);
      const response = await admin.messaging().sendEachForMulticast({
        tokens: batch,
        ...message,
      });
      successCount += response.successCount;
    }

    logger.info(`FCM: Sent to ${successCount}/${fcmTokens.length} devices`);
    return successCount;
  } catch (err: any) {
    logger.error('FCM batch send error:', err.message);
    return 0;
  }
}

/**
 * Send push notification to a topic (e.g. 'all', 'district-gurugram', 'emergency')
 */
export async function sendPushToTopic(topic: string, title: string, body: string, data?: Record<string, string>): Promise<boolean> {
  if (!initialized) return false;

  try {
    await admin.messaging().send({
      topic,
      notification: { title, body },
      data: data ?? {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'high_importance',
        },
      },
    });
    logger.info(`FCM: Sent to topic '${topic}'`);
    return true;
  } catch (err: any) {
    logger.error(`FCM topic send error (${topic}):`, err.message);
    return false;
  }
}
