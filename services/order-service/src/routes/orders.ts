import { Router, Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { createOrder } from '../saga/state-machine';
import { logger } from '../lib/logger';

const router = Router();
const prisma = new PrismaClient();

// POST /orders — Create a new order
router.post('/', async (req: Request, res: Response): Promise<void> => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const userId = req.headers['x-user-id'] as string;
  const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
  const log = logger.child({ correlationId, userId, action: 'createOrder' });

  try {
    if (!userId) {
      res.status(401).json({
        error: 'UNAUTHORIZED',
        message: 'User ID not found in request',
        correlationId,
      });
      return;
    }

    const { items } = req.body;

    if (!items || !Array.isArray(items) || items.length === 0) {
      res.status(400).json({
        error: 'VALIDATION_ERROR',
        message: 'Items array is required and must not be empty',
        correlationId,
      });
      return;
    }

    // Validate items structure
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity < 1) {
        res.status(400).json({
          error: 'VALIDATION_ERROR',
          message: 'Each item must have a productId and quantity >= 1',
          correlationId,
        });
        return;
      }
    }

    // Calculate total (in real system, would fetch prices from inventory)
    // For now, we pass a placeholder — inventory service will validate
    const totalAmount = req.body.totalAmount || '0.00';

    const { order, isIdempotent } = await createOrder(
      userId,
      items,
      totalAmount,
      correlationId,
      idempotencyKey,
    );

    if (isIdempotent) {
      log.info('Idempotent response returned');
      res.status(200).json(order);
      return;
    }

    log.info({ orderId: order.id }, 'Order created successfully');
    res.status(201).json(order);
  } catch (error) {
    log.error({ error }, 'Failed to create order');
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
    });
  }
});

// GET /orders/:id — Get order by ID
router.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const correlationId = (req.headers['x-correlation-id'] as string) || uuidv4();
  const userId = req.headers['x-user-id'] as string;
  const orderId = req.params.id;
  const log = logger.child({ correlationId, userId, orderId, action: 'getOrder' });

  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { sagaState: true },
    });

    if (!order) {
      res.status(404).json({
        error: 'NOT_FOUND',
        message: 'Order not found',
        correlationId,
      });
      return;
    }

    if (order.userId !== userId) {
      res.status(403).json({
        error: 'FORBIDDEN',
        message: 'You do not have access to this order',
        correlationId,
      });
      return;
    }

    log.info('Order retrieved');
    res.status(200).json(order);
  } catch (error) {
    log.error({ error }, 'Failed to get order');
    res.status(500).json({
      error: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      correlationId,
    });
  }
});

export { router as orderRoutes };
