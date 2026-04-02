import { PrismaClient, Prisma } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../lib/logger';
import { config } from '../config';
import {
  OrderCreatedV1,
  PaymentProcessRequestedV1,
  OrderConfirmedV1,
  OrderFailedV1,
  InventoryReleaseRequestedV1,
  NotificationSendRequestedV1,
} from '../events/types';

const prisma = new PrismaClient();

// ============================================
// ORDER STATUS CONSTANTS
// ============================================

export const OrderStatus = {
  PENDING: 'PENDING',
  INVENTORY_RESERVED: 'INVENTORY_RESERVED',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
} as const;

export const SagaStatus = {
  ACTIVE: 'ACTIVE',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
} as const;

// ============================================
// SAGA TRANSITIONS
// ============================================

/**
 * Create a new order with PENDING status.
 * Writes order + saga state + outbox event in a SINGLE transaction.
 * This is the Transactional Outbox pattern.
 */
export async function createOrder(
  userId: string,
  items: Array<{ productId: string; quantity: number }>,
  totalAmount: string,
  correlationId: string,
  idempotencyKey?: string,
): Promise<{ order: any; isIdempotent: boolean }> {
  const log = logger.child({ correlationId, action: 'createOrder' });

  // Check idempotency key
  if (idempotencyKey) {
    const existing = await prisma.idempotencyKey.findUnique({
      where: { key: idempotencyKey },
    });
    if (existing) {
      log.info({ idempotencyKey }, 'Idempotent request — returning cached response');
      return { order: existing.response, isIdempotent: true };
    }
  }

  const orderId = uuidv4();
  const eventId = uuidv4();
  const sagaId = uuidv4();

  const event: OrderCreatedV1 = {
    eventId,
    eventType: 'order.created.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: {
      orderId,
      userId,
      items,
      totalAmount,
    },
  };

  // Single DB transaction: Order + SagaState + OutboxEvent + IdempotencyKey
  const result = await prisma.$transaction(async (tx) => {
    const order = await tx.order.create({
      data: {
        id: orderId,
        userId,
        items: items as unknown as Prisma.InputJsonValue,
        totalAmount: new Prisma.Decimal(totalAmount),
        status: OrderStatus.PENDING,
        idempotencyKey,
      },
    });

    await tx.sagaState.create({
      data: {
        id: sagaId,
        orderId,
        currentStep: OrderStatus.PENDING,
        status: SagaStatus.ACTIVE,
      },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: event.eventType,
        payload: event as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    if (idempotencyKey) {
      await tx.idempotencyKey.create({
        data: {
          key: idempotencyKey,
          response: order as unknown as Prisma.InputJsonValue,
        },
      });
    }

    return order;
  });

  log.info({ orderId, userId }, 'Order created with PENDING status');
  return { order: result, isIdempotent: false };
}

/**
 * Handle inventory.reserved.v1 event.
 * Transition: PENDING → INVENTORY_RESERVED → PAYMENT_PENDING
 * Write payment request to outbox.
 */
export async function handleInventoryReserved(
  orderId: string,
  correlationId: string,
  eventId: string,
): Promise<void> {
  const log = logger.child({ correlationId, orderId, action: 'handleInventoryReserved' });

  // Idempotency check
  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    log.info({ eventId }, 'Event already processed — skipping');
    return;
  }

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { sagaState: true },
  });

  if (!order || !order.sagaState) {
    log.warn('Order or saga not found');
    return;
  }

  if (order.status !== OrderStatus.PENDING) {
    log.warn({ currentStatus: order.status }, 'Order not in PENDING state — skipping');
    return;
  }

  const paymentEventId = uuidv4();
  const paymentEvent: PaymentProcessRequestedV1 = {
    eventId: paymentEventId,
    eventType: 'payment.process_requested.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: {
      orderId,
      userId: order.userId,
      totalAmount: order.totalAmount.toString(),
    },
  };

  // Atomic transition + outbox write
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.PAYMENT_PENDING },
    });

    await tx.sagaState.update({
      where: { orderId },
      data: {
        currentStep: OrderStatus.PAYMENT_PENDING,
        timeoutAt: new Date(Date.now() + config.sagaTimeoutMs),
      },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: paymentEvent.eventType,
        payload: paymentEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.processedEvent.create({
      data: { eventId, eventType: 'inventory.reserved.v1' },
    });
  });

  log.info('Saga transitioned to PAYMENT_PENDING');
}

/**
 * Handle inventory.failed.v1 event.
 * Transition: PENDING → FAILED
 */
export async function handleInventoryFailed(
  orderId: string,
  reason: string,
  correlationId: string,
  eventId: string,
): Promise<void> {
  const log = logger.child({ correlationId, orderId, action: 'handleInventoryFailed' });

  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    log.info({ eventId }, 'Event already processed — skipping');
    return;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== OrderStatus.PENDING) {
    log.warn('Order not in PENDING state — skipping');
    return;
  }

  const failedEventId = uuidv4();
  const failedEvent: OrderFailedV1 = {
    eventId: failedEventId,
    eventType: 'order.failed.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: { orderId, userId: order.userId, reason },
  };

  const notifEvent: NotificationSendRequestedV1 = {
    eventId: uuidv4(),
    eventType: 'notification.send_requested.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: {
      orderId,
      userId: order.userId,
      type: 'ORDER_FAILED',
      message: `Order ${orderId} failed: ${reason}`,
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FAILED },
    });

    await tx.sagaState.update({
      where: { orderId },
      data: { currentStep: OrderStatus.FAILED, status: SagaStatus.FAILED },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: failedEvent.eventType,
        payload: failedEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: notifEvent.eventType,
        payload: notifEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.processedEvent.create({
      data: { eventId, eventType: 'inventory.failed.v1' },
    });
  });

  log.info({ reason }, 'Order FAILED — inventory unavailable');
}

/**
 * Handle payment.succeeded.v1 event.
 * Transition: PAYMENT_PENDING → CONFIRMED
 */
export async function handlePaymentSucceeded(
  orderId: string,
  correlationId: string,
  eventId: string,
): Promise<void> {
  const log = logger.child({ correlationId, orderId, action: 'handlePaymentSucceeded' });

  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    log.info({ eventId }, 'Event already processed — skipping');
    return;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== OrderStatus.PAYMENT_PENDING) {
    log.warn('Order not in PAYMENT_PENDING state — skipping');
    return;
  }

  const confirmedEvent: OrderConfirmedV1 = {
    eventId: uuidv4(),
    eventType: 'order.confirmed.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: { orderId, userId: order.userId, totalAmount: order.totalAmount.toString() },
  };

  const notifEvent: NotificationSendRequestedV1 = {
    eventId: uuidv4(),
    eventType: 'notification.send_requested.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: {
      orderId,
      userId: order.userId,
      type: 'ORDER_CONFIRMED',
      message: `Order ${orderId} confirmed! Total: $${order.totalAmount}`,
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.CONFIRMED },
    });

    await tx.sagaState.update({
      where: { orderId },
      data: { currentStep: OrderStatus.CONFIRMED, status: SagaStatus.COMPLETED },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: confirmedEvent.eventType,
        payload: confirmedEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: notifEvent.eventType,
        payload: notifEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.processedEvent.create({
      data: { eventId, eventType: 'payment.succeeded.v1' },
    });
  });

  log.info('Order CONFIRMED — saga completed successfully');
}

/**
 * Handle payment.failed.v1 event.
 * Transition: PAYMENT_PENDING → FAILED + release inventory compensation.
 */
export async function handlePaymentFailed(
  orderId: string,
  reason: string,
  correlationId: string,
  eventId: string,
): Promise<void> {
  const log = logger.child({ correlationId, orderId, action: 'handlePaymentFailed' });

  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    log.info({ eventId }, 'Event already processed — skipping');
    return;
  }

  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (!order || order.status !== OrderStatus.PAYMENT_PENDING) {
    log.warn('Order not in PAYMENT_PENDING state — skipping');
    return;
  }

  // Compensation: release inventory
  const releaseEvent: InventoryReleaseRequestedV1 = {
    eventId: uuidv4(),
    eventType: 'inventory.release_requested.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: { orderId },
  };

  const failedEvent: OrderFailedV1 = {
    eventId: uuidv4(),
    eventType: 'order.failed.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: { orderId, userId: order.userId, reason },
  };

  const notifEvent: NotificationSendRequestedV1 = {
    eventId: uuidv4(),
    eventType: 'notification.send_requested.v1',
    correlationId,
    timestamp: new Date().toISOString(),
    payload: {
      orderId,
      userId: order.userId,
      type: 'ORDER_FAILED',
      message: `Order ${orderId} failed: ${reason}`,
    },
  };

  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: OrderStatus.FAILED },
    });

    await tx.sagaState.update({
      where: { orderId },
      data: { currentStep: OrderStatus.FAILED, status: SagaStatus.FAILED },
    });

    // Compensation event
    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: releaseEvent.eventType,
        payload: releaseEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: failedEvent.eventType,
        payload: failedEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.outboxEvent.create({
      data: {
        id: uuidv4(),
        eventType: notifEvent.eventType,
        payload: notifEvent as unknown as Prisma.InputJsonValue,
        correlationId,
        status: 'PENDING',
      },
    });

    await tx.processedEvent.create({
      data: { eventId, eventType: 'payment.failed.v1' },
    });
  });

  log.info({ reason }, 'Order FAILED — payment failed, compensation triggered');
}

/**
 * Handle saga timeouts.
 * Finds sagas stuck in PAYMENT_PENDING past their deadline.
 */
export async function handleTimeouts(): Promise<void> {
  const log = logger.child({ action: 'timeoutHandler' });

  const staleSagas = await prisma.sagaState.findMany({
    where: {
      currentStep: OrderStatus.PAYMENT_PENDING,
      status: SagaStatus.ACTIVE,
      timeoutAt: { lt: new Date() },
    },
    include: { order: true },
  });

  for (const saga of staleSagas) {
    const correlationId = uuidv4();
    log.warn({ orderId: saga.orderId }, 'Saga timeout detected — triggering compensation');

    const releaseEvent: InventoryReleaseRequestedV1 = {
      eventId: uuidv4(),
      eventType: 'inventory.release_requested.v1',
      correlationId,
      timestamp: new Date().toISOString(),
      payload: { orderId: saga.orderId },
    };

    const failedEvent: OrderFailedV1 = {
      eventId: uuidv4(),
      eventType: 'order.failed.v1',
      correlationId,
      timestamp: new Date().toISOString(),
      payload: {
        orderId: saga.orderId,
        userId: saga.order.userId,
        reason: 'Payment timeout — SLA exceeded',
      },
    };

    const notifEvent: NotificationSendRequestedV1 = {
      eventId: uuidv4(),
      eventType: 'notification.send_requested.v1',
      correlationId,
      timestamp: new Date().toISOString(),
      payload: {
        orderId: saga.orderId,
        userId: saga.order.userId,
        type: 'ORDER_FAILED',
        message: `Order ${saga.orderId} failed: Payment timeout`,
      },
    };

    await prisma.$transaction(async (tx) => {
      await tx.order.update({
        where: { id: saga.orderId },
        data: { status: OrderStatus.FAILED },
      });

      await tx.sagaState.update({
        where: { orderId: saga.orderId },
        data: { currentStep: OrderStatus.FAILED, status: SagaStatus.FAILED },
      });

      await tx.outboxEvent.create({
        data: {
          id: uuidv4(),
          eventType: releaseEvent.eventType,
          payload: releaseEvent as unknown as Prisma.InputJsonValue,
          correlationId,
          status: 'PENDING',
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: uuidv4(),
          eventType: failedEvent.eventType,
          payload: failedEvent as unknown as Prisma.InputJsonValue,
          correlationId,
          status: 'PENDING',
        },
      });

      await tx.outboxEvent.create({
        data: {
          id: uuidv4(),
          eventType: notifEvent.eventType,
          payload: notifEvent as unknown as Prisma.InputJsonValue,
          correlationId,
          status: 'PENDING',
        },
      });
    });

    log.info({ orderId: saga.orderId }, 'Timeout compensation completed');
  }
}

export { prisma };
