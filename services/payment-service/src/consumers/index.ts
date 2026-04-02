import { Consumer } from 'kafkajs';
import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { getProducer } from '../lib/kafka';
import { logger } from '../lib/logger';
import { checkFailureInjection, delay } from '../failure-injector';

const prisma = new PrismaClient();

interface PaymentProcessRequestedV1 {
  eventId: string;
  eventType: 'payment.process_requested.v1';
  correlationId: string;
  timestamp: string;
  payload: {
    orderId: string;
    userId: string;
    totalAmount: string;
  };
}

/**
 * Handle payment.process_requested.v1 — Process (simulate) payment.
 */
async function handlePaymentRequest(event: PaymentProcessRequestedV1): Promise<void> {
  const { orderId, totalAmount } = event.payload;
  const correlationId = event.correlationId;
  const eventId = event.eventId;
  const log = logger.child({ correlationId, orderId, eventId, action: 'processPayment' });

  // Idempotency check
  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    log.info('Event already processed — skipping (idempotent)');
    return;
  }

  // Also check if payment already exists for this order
  const existingPayment = await prisma.payment.findUnique({
    where: { orderId },
  });
  if (existingPayment) {
    log.info({ paymentId: existingPayment.id }, 'Payment already exists for order — skipping');
    return;
  }

  const producer = getProducer();

  // ==============================
  // FAILURE INJECTION CHECKS
  // ==============================
  const failures = checkFailureInjection(orderId);

  // Crash mode — exit process mid-handling (Docker will restart)
  if (failures.shouldCrash) {
    log.error('💥 CRASH MODE: Exiting process mid-handling!');
    process.exit(1);
  }

  // Timeout simulation — artificial delay
  if (failures.delayMs > 0) {
    log.warn({ delayMs: failures.delayMs }, '⏳ TIMEOUT MODE: Delaying processing...');
    await delay(failures.delayMs);
  }

  // Random failure
  if (failures.shouldFail) {
    log.warn({ reason: failures.reason }, '❌ RANDOM FAILURE: Payment will fail');

    await prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          orderId,
          amount: new Prisma.Decimal(totalAmount),
          status: 'FAILED',
        },
      });
      await tx.processedEvent.create({
        data: { eventId, eventType: 'payment.process_requested.v1' },
      });
    });

    const failedEvent = {
      eventId: uuidv4(),
      eventType: 'payment.failed.v1',
      correlationId,
      timestamp: new Date().toISOString(),
      payload: { orderId, reason: failures.reason || 'Payment processing failed' },
    };

    await producer.send({
      topic: 'payment.failed.v1',
      messages: [{
        key: orderId,
        value: JSON.stringify(failedEvent),
        headers: { 'correlation-id': correlationId, 'event-id': failedEvent.eventId },
      }],
    });

    log.info('Payment failed event published');
    return;
  }

  // ==============================
  // HAPPY PATH — Payment succeeds
  // ==============================

  const paymentId = uuidv4();

  await prisma.$transaction(async (tx) => {
    await tx.payment.create({
      data: {
        id: paymentId,
        orderId,
        amount: new Prisma.Decimal(totalAmount),
        status: 'SUCCEEDED',
      },
    });
    await tx.processedEvent.create({
      data: { eventId, eventType: 'payment.process_requested.v1' },
    });
  });

  const succeededEvent = {
    eventId: uuidv4(),
    eventType: 'payment.succeeded.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: { orderId, paymentId, amount: totalAmount },
  };

  await producer.send({
    topic: 'payment.succeeded.v1',
    messages: [{
      key: orderId,
      value: JSON.stringify(succeededEvent),
      headers: { 'correlation-id': correlationId, 'event-id': succeededEvent.eventId },
    }],
  });

  // Duplicate event mode — publish the same event again
  if (failures.shouldDuplicate) {
    log.warn('🔁 DUPLICATE MODE: Publishing response event a second time');
    await producer.send({
      topic: 'payment.succeeded.v1',
      messages: [{
        key: orderId,
        value: JSON.stringify(succeededEvent),
        headers: { 'correlation-id': correlationId, 'event-id': succeededEvent.eventId },
      }],
    });
  }

  log.info({ paymentId }, 'Payment succeeded');
}

export async function startConsumers(consumer: Consumer): Promise<void> {
  const log = logger.child({ component: 'consumers' });

  await consumer.subscribe({
    topics: ['payment.process_requested.v1'],
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = message.value?.toString();
      if (!value) return;

      try {
        const event = JSON.parse(value);
        await handlePaymentRequest(event);
      } catch (error) {
        log.error({ topic, error }, 'Failed to process payment event');
      }
    },
  });

  log.info('Payment consumers started');
}
