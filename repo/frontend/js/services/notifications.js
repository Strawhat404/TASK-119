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
  applyFailedDelivery,
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
  try {
    applyDelivery(notification);
    await DB.put('notifications', notification);
    return notification;
  } catch (err) {
    applyFailedDelivery(notification);
    try { await DB.put('notifications', notification); } catch {}
    return notification;
  }
}

export async function retryFailedNotifications() {
  const all = await DB.getAll('notifications');
  // Retryable: notifications that failed delivery but haven't exhausted retries.
  // applyFailedDelivery increments retryCount and only sets status='failed' at MAX_RETRIES,
  // so retryable notifications are still 'pending' with retryCount > 0 and < MAX_RETRIES.
  const retryable = all.filter(n => n.status === 'pending' && n.retryCount > 0 && n.retryCount < MAX_RETRIES);
  const results = [];

  for (const n of retryable) {
    const result = await deliverNotification(n);
    results.push(result);
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
