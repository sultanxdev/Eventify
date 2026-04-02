import { Consumer } from 'kafkajs';
import { logger } from '../lib/logger';
import {
  handleInventoryReserved,
  handleInventoryFailed,
  handlePaymentSucceeded,
  handlePaymentFailed,
} from '../saga/state-machine';

/**
 * Kafka event consumers for the Order Service.
 * 
 * Listens to response events from Inventory and Payment services
 * and drives saga state transitions.
 */
export async function startConsumers(consumer: Consumer): Promise<void> {
  const log = logger.child({ component: 'consumers' });

  // Subscribe to response events
  await consumer.subscribe({ topics: [
    'inventory.reserved.v1',
    'inventory.failed.v1',
    'payment.succeeded.v1',
    'payment.failed.v1',
    'inventory.released.v1',
  ], fromBeginning: false });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = message.value?.toString();
      if (!value) return;

      try {
        const event = JSON.parse(value);
        const eventId = event.eventId;
        const correlationId = event.correlationId || '';
        const orderId = event.payload?.orderId;

        const consumerLog = log.child({
          topic,
          eventId,
          correlationId,
          orderId,
        });

        consumerLog.info('Processing event');

        switch (topic) {
          case 'inventory.reserved.v1':
            await handleInventoryReserved(orderId, correlationId, eventId);
            break;

          case 'inventory.failed.v1':
            await handleInventoryFailed(
              orderId,
              event.payload?.reason || 'Unknown',
              correlationId,
              eventId,
            );
            break;

          case 'payment.succeeded.v1':
            await handlePaymentSucceeded(orderId, correlationId, eventId);
            break;

          case 'payment.failed.v1':
            await handlePaymentFailed(
              orderId,
              event.payload?.reason || 'Unknown',
              correlationId,
              eventId,
            );
            break;

          case 'inventory.released.v1':
            consumerLog.info('Inventory released — acknowledged');
            break;

          default:
            consumerLog.warn('Unknown event type — skipping');
        }
      } catch (error) {
        log.error({ topic, error }, 'Failed to process event');
        // In production, this would go to DLQ after max retries
      }
    },
  });

  log.info('Event consumers started');
}
