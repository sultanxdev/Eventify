// Initialize tracing BEFORE importing anything else
import './lib/tracing';

import express from 'express';
import { PrismaClient } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { initKafkaProducer, initKafkaConsumer, disconnectKafka } from './lib/kafka';
import { startConsumers } from './consumers';
import { config } from './config';
import { logger } from './lib/logger';

const app = express();
const prisma = new PrismaClient();

app.use(express.json());

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'inventory-service',
    timestamp: new Date().toISOString(),
  });
});

// Seed endpoint — creates sample products for testing
app.post('/seed', async (_req, res) => {
  try {
    const products = [
      { id: uuidv4(), name: 'Mechanical Keyboard', stock: 50, price: 149.99 },
      { id: uuidv4(), name: 'Gaming Mouse', stock: 100, price: 79.99 },
      { id: uuidv4(), name: 'USB-C Hub', stock: 30, price: 49.99 },
      { id: uuidv4(), name: '27" Monitor', stock: 15, price: 399.99 },
      { id: uuidv4(), name: 'Webcam HD', stock: 75, price: 89.99 },
    ];

    for (const product of products) {
      await prisma.product.upsert({
        where: { id: product.id },
        update: {},
        create: product,
      });
    }

    const allProducts = await prisma.product.findMany();
    res.status(200).json({ message: 'Seed complete', products: allProducts });
  } catch (error) {
    logger.error({ error }, 'Seed failed');
    res.status(500).json({ error: 'Seed failed' });
  }
});

// Get all products
app.get('/products', async (_req, res) => {
  const products = await prisma.product.findMany();
  res.json(products);
});

// Start everything
async function start(): Promise<void> {
  try {
    await initKafkaProducer();
    const consumer = await initKafkaConsumer('inventory-service-group');
    await startConsumers(consumer);

    app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Inventory service started');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start inventory service');
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await disconnectKafka();
  process.exit(0);
});

start();

export { app };
