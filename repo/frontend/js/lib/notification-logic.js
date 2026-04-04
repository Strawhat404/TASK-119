/**
 * Pure notification logic — no browser/DB dependencies.
 */

export const MAX_RETRIES = 3;

export const TEMPLATES = {
  reservation_approved: 'Your reservation #{reservationId} has been approved.',
  reservation_denied: 'Your reservation #{reservationId} has been denied.',
  reservation_reminder_24h: 'Reminder: Your reservation #{reservationId} at {zone} is in 24 hours.',
  reservation_reminder_1h: 'Reminder: Your reservation #{reservationId} at {zone} is in 1 hour.',
  unlock_success: 'Door "{doorName}" has been unlocked successfully.',
  unlock_failed: 'Failed to unlock door "{doorName}". Please try again.',
  content_flagged: 'Content "{contentTitle}" has been flagged for review.',
  content_published: 'Content "{contentTitle}" has been published.',
  overdue_item: 'Overdue: {itemDescription} requires attention.',
  missing_materials: 'Missing materials for reservation #{reservationId}: {details}.',
  account_locked: 'Your account has been locked due to multiple failed login attempts.',
  user_banned: 'Account "{username}" has been banned. Reason: {reason}'
};

export function resolveTemplate(templateId, variables = {}) {
  let template = TEMPLATES[templateId];
  if (!template) return templateId;

  for (const [key, value] of Object.entries(variables)) {
    template = template.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
  }
  return template;
}

export function createNotificationObject({ userId, templateId, variables, type = 'info', scheduledFor = null }) {
  const message = resolveTemplate(templateId, variables);
  return {
    userId,
    templateId,
    variables,
    message,
    type,
    read: false,
    status: 'pending',
    retryCount: 0,
    scheduledFor: scheduledFor || Date.now(),
    createdAt: Date.now(),
    deliveredAt: null,
    failedAt: null
  };
}

export function applyDelivery(notif) {
  notif.status = 'delivered';
  notif.deliveredAt = Date.now();
  return notif;
}

export function applyFailedDelivery(notif) {
  notif.retryCount += 1;
  if (notif.retryCount >= MAX_RETRIES) {
    notif.status = 'failed';
    notif.failedAt = Date.now();
  }
  return notif;
}
