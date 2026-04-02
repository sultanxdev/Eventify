import { Consumer } from 'kafkajs';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { getProducer } from '../lib/kafka';
import { logger } from '../lib/logger';
import {
  OrderCreatedV1,
  InventoryReservedV1,
  InventoryFailedV1,
  InventoryReleasedV1,
} from '../events/types';

const prisma = new PrismaClient();

/**
 * Handle order.created.v1 — Reserve inventory for the order.
 * Uses SELECT FOR UPDATE for concurrency-safe stock updates.
 */
async function handleOrderCreated(event: OrderCreatedV1): Promise<void> {
  const { orderId, items } = event.payload;
  const correlationId = event.correlationId;
  const eventId = event.eventId;
  const log = logger.child({ correlationId, orderId, eventId, action: 'reserveInventory' });

  // Idempotency check
  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    log.info('Event already processed — skipping');
    return;
  }

  const producer = getProducer();

  try {
    // Attempt to reserve all items atomically using raw SQL for SELECT FOR UPDATE
    const reservedItems: Array<{ productId: string; quantity: number }> = [];

    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        // Lock the row for update (concurrency-safe)
        const products = await tx.$queryRaw<Array<{ id: string; stock: number; price: string }>>`
          SELECT id, stock, price FROM products WHERE id = ${item.productId} FOR UPDATE
        `;

        if (products.length === 0) {
          throw new Error(`Product ${item.productId} not found`);
        }

        const product = products[0];

        if (product.stock < item.quantity) {
          throw new Error(
            `Insufficient stock for product ${item.productId}: requested ${item.quantity}, available ${product.stock}`
          );
        }

        // Decrement stock
        await tx.$executeRaw`
          UPDATE products SET stock = stock - ${item.quantity}, updated_at = NOW()
          WHERE id = ${item.productId}
        `;

        // Create reservation
        await tx.reservation.create({
          data: {
            id: uuidv4(),
            orderId,
            productId: item.productId,
            quantity: item.quantity,
            status: 'RESERVED',
          },
        });

        reservedItems.push({ productId: item.productId, quantity: item.quantity });
      }

      // Record processed event (idempotency)
      await tx.processedEvent.create({
        data: { eventId, eventType: 'order.created.v1' },
      });
    });

    // Publish success event
    const reservedEvent: InventoryReservedV1 = {
      eventId: uuidv4(),
      eventType: 'inventory.reserved.v1',
      correlationId,
      timestamp: new Date().toISOString(),
      payload: { orderId, reservedItems },
    };

    await producer.send({
      topic: 'inventory.reserved.v1',
      messages: [{
        key: orderId,
        value: JSON.stringify(reservedEvent),
        headers: {
          'correlation-id': correlationId,
          'event-id': reservedEvent.eventId,
        },
      }],
    });

    log.info({ reservedItems }, 'Inventory reserved successfully');
  } catch (error: any) {
    log.warn({ error: error.message }, 'Inventory reservation failed');

    // Record processed event even on failure
    await prisma.processedEvent.create({
      data: { eventId, eventType: 'order.created.v1' },
    }).catch(() => {}); // Ignore if already exists

    // Publish failure event
    const failedEvent: InventoryFailedV1 = {
      eventId: uuidv4(),
      eventType: 'inventory.failed.v1',
      correlationId,
      timestamp: new Date().toISOString(),
      payload: { orderId, reason: error.message },
    };

    await producer.send({
      topic: 'inventory.failed.v1',
      messages: [{
        key: orderId,
        value: JSON.stringify(failedEvent),
        headers: {
          'correlation-id': correlationId,
          'event-id': failedEvent.eventId,
        },
      }],
    });
  }
}

/**
 * Handle inventory.release_requested.v1 — Compensation: release reserved stock.
 */
async function handleInventoryRelease(event: { eventId: string; correlationId: string; payload: { orderId: string } }): Promise<void> {
  const { orderId } = event.payload;
  const correlationId = event.correlationId;
  const eventId = event.eventId;
  const log = logger.child({ correlationId, orderId, eventId, action: 'releaseInventory' });

  // Idempotency check
  const alreadyProcessed = await prisma.processedEvent.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    log.info('Event already processed — skipping');
    return;
  }

  const producer = getProducer();

  try {
    await prisma.$transaction(async (tx) => {
      // Find all RESERVED reservations for this order
      const reservations = await tx.reservation.findMany({
        where: { orderId, status: 'RESERVED' },
      });

      for (const reservation of reservations) {
        // Restore stock
        await tx.$executeRaw`
          UPDATE products SET stock = stock + ${reservation.quantity}, updated_at = NOW()
          WHERE id = ${reservation.productId}
        `;

        // Mark reservation as released
        await tx.reservation.update({
          where: { id: reservation.id },
          data: { status: 'RELEASED' },
        });
      }

      await tx.processedEvent.create({
        data: { eventId, eventType: 'inventory.release_requested.v1' },
      });
    });

    // Publish released event
    const releasedEvent: InventoryReleasedV1 = {
      eventId: uuidv4(),
      eventType: 'inventory.released.v1',
      correlationId,
      timestamp: new Date().toISOString(),
      payload: { orderId },
    };

    await producer.send({
      topic: 'inventory.released.v1',
      messages: [{
        key: orderId,
        value: JSON.stringify(releasedEvent),
        headers: {
          'correlation-id': correlationId,
          'event-id': releasedEvent.eventId,
        },
      }],
    });

    log.info('Inventory released (compensation)');
  } catch (error) {
    log.error({ error }, 'Failed to release inventory');
  }
}

/**
 * Start Kafka consumers for the Inventory Service.
 */
export async function startConsumers(consumer: Consumer): Promise<void> {
  const log = logger.child({ component: 'consumers' });

  await consumer.subscribe({
    topics: ['order.created.v1', 'inventory.release_requested.v1'],
    fromBeginning: false,
  });

  await consumer.run({
    eachMessage: async ({ topic, message }) => {
      const value = message.value?.toString();
      if (!value) return;

      try {
        const event = JSON.parse(value);

        switch (topic) {
          case 'order.created.v1':
            await handleOrderCreated(event);
            break;

          case 'inventory.release_requested.v1':
            await handleInventoryRelease(event);
            break;

          default:
            log.warn({ topic }, 'Unknown topic — skipping');
        }
      } catch (error) {
        log.error({ topic, error }, 'Failed to process event');
      }
    },
  });

  log.info('Inventory consumers started');
}
