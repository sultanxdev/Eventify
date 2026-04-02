import { Consumer } from 'kafkajs';
import { logger } from '../lib/logger';

/**
 * Notification consumers — handles order lifecycle notifications.
 * 
 * This service is STATELESS — no database.
 * In production, this would send emails, SMS, push notifications, etc.
 * Here, we log the notification (simulated).
 */
export async function startConsumers(consumer: Consumer): Promise<void> {
  const log = logger.child({ component: 'consumers' });

  await consumer.subscribe({
    topics: [
      'order.confirmed.v1',
      'order.failed.v1',
      'notification.send_requested.v1',
    ],
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = message.value?.toString();
      if (!value) return;

      try {
        const event = JSON.parse(value);
        const correlationId = event.correlationId || '';
        const orderId = event.payload?.orderId || '';

        const msgLog = log.child({ topic, correlationId, orderId, eventId: event.eventId });

        switch (topic) {
          case 'order.confirmed.v1':
            msgLog.info(
              { userId: event.payload?.userId, totalAmount: event.payload?.totalAmount },
              '✅ NOTIFICATION: Order confirmed! Email/SMS would be sent.'
            );
            break;

          case 'order.failed.v1':
            msgLog.info(
              { userId: event.payload?.userId, reason: event.payload?.reason },
              '❌ NOTIFICATION: Order failed. Email/SMS would be sent.'
            );
            break;

          case 'notification.send_requested.v1':
            msgLog.info(
              {
                userId: event.payload?.userId,
                type: event.payload?.type,
                message: event.payload?.message,
              },
              '📬 NOTIFICATION: Send requested'
            );
            break;

          default:
            msgLog.warn('Unknown notification topic');
        }
      } catch (error) {
        log.error({ topic, error }, 'Failed to process notification event');
      }
    },
  });

  log.info('Notification consumers started');
}
