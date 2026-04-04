/**
 * Notification service.
 * - Templates with variables: {reservationId}, {doorName}, etc.
 * - Scheduled reminders: 24h and 1h before reservation start
 * - Local retry: up to 3 attempts
 * - Delivered/failed receipts
 */
import DB from '../database.js';
import {
  resolveTemplate,
  createNotificationObject,
  applyDelivery,
  TEMPLATES,
  MAX_RETRIES
} from '../lib/notification-logic.js';

// Re-export pure functions
export { resolveTemplate } from '../lib/notification-logic.js';

export async function createNotification({ userId, templateId, variables, type = 'info', scheduledFor = null }) {
  const notification = createNotificationObject({ userId, templateId, variables, type, scheduledFor });

  const id = await DB.add('notifications', notification);
  notification.id = id;

  // Attempt immediate delivery if not scheduled in future
  if (!scheduledFor || scheduledFor <= Date.now()) {
    return deliverNotification(notification);
  }

  return notification;
}

export async function deliverNotification(notification) {
  applyDelivery(notification);
  await DB.put('notifications', notification);
  return notification;
}

export async function retryFailedNotifications() {
  const all = await DB.getAll('notifications');
  const failed = all.filter(n => n.status === 'failed' && n.retryCount < MAX_RETRIES);
  const results = [];

  for (const n of failed) {
    n.retryCount += 1;
    try {
      const result = await deliverNotification(n);
      results.push(result);
    } catch {
      if (n.retryCount >= MAX_RETRIES) {
        n.status = 'failed';
        n.failedAt = Date.now();
      }
      await DB.put('notifications', n);
      results.push(n);
    }
  }

  return results;
}

export async function processScheduledNotifications() {
  const all = await DB.getAll('notifications');
  const now = Date.now();
  const due = all.filter(n => n.status === 'pending' && n.scheduledFor && n.scheduledFor <= now);

  for (const n of due) {
    await deliverNotification(n);
  }

  return due.length;
}

export async function scheduleReservationReminders(reservation) {
  const startTime = new Date(`${reservation.date}T${reservation.time}`).getTime();

  // 24h reminder
  const reminder24h = startTime - 24 * 60 * 60 * 1000;
  if (reminder24h > Date.now()) {
    await createNotification({
      userId: reservation.userId,
      templateId: 'reservation_reminder_24h',
      variables: { reservationId: reservation.id, zone: reservation.zone },
      type: 'info',
      scheduledFor: reminder24h
    });
  }

  // 1h reminder
  const reminder1h = startTime - 60 * 60 * 1000;
  if (reminder1h > Date.now()) {
    await createNotification({
      userId: reservation.userId,
      templateId: 'reservation_reminder_1h',
      variables: { reservationId: reservation.id, zone: reservation.zone },
      type: 'warning',
      scheduledFor: reminder1h
    });
  }
}

export function getTemplates() {
  return { ...TEMPLATES };
}

export async function getUserNotifications(userId) {
  if (userId) {
    return DB.getByIndex('notifications', 'userId', userId);
  }
  return DB.getAll('notifications');
}
