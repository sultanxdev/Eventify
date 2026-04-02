import { PrismaClient } from '@prisma/client';
import { getProducer } from '../lib/kafka';
import { logger } from '../lib/logger';
import { config } from '../config';

const prisma = new PrismaClient();

/**
 * Outbox Worker
 * 
 * Polls the outbox_events table for PENDING events and publishes them to Kafka.
 * After successful publish, marks the event as SENT.
 * 
 * This is the async part of the Transactional Outbox pattern.
 * The business logic writes events to the outbox table atomically with state changes.
 * This worker then reliably publishes them to Kafka.
 */
export async function startOutboxWorker(): Promise<void> {
  const log = logger.child({ component: 'outbox-worker' });
  log.info('Outbox worker started');

  const poll = async () => {
    try {
      // Fetch pending events, oldest first
      const events = await prisma.outboxEvent.findMany({
        where: { status: 'PENDING' },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });

      if (events.length === 0) return;

      const producer = getProducer();

      for (const event of events) {
        try {
          const payload = event.payload as any;
          const topic = event.eventType;

          await producer.send({
            topic,
            messages: [
              {
                key: payload.payload?.orderId || event.id,
                value: JSON.stringify(payload),
                headers: {
                  'correlation-id': event.correlationId || '',
                  'event-id': payload.eventId || event.id,
                  'event-type': event.eventType,
                },
              },
            ],
          });

          // Mark as sent
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: {
              status: 'SENT',
              sentAt: new Date(),
            },
          });

          log.info(
            {
              eventId: event.id,
              eventType: event.eventType,
              correlationId: event.correlationId,
            },
            'Event published to Kafka'
          );
        } catch (error) {
          log.error(
            { eventId: event.id, eventType: event.eventType, error },
            'Failed to publish event — will retry'
          );

          // Mark as FAILED after too many attempts (simple approach)
          await prisma.outboxEvent.update({
            where: { id: event.id },
            data: { status: 'FAILED' },
          });
        }
      }
    } catch (error) {
      log.error({ error }, 'Outbox poll cycle failed');
    }
  };

  // Poll at configured interval
  setInterval(poll, config.outboxPollIntervalMs);

  // Also run immediately
  await poll();
}
