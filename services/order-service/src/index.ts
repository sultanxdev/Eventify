// Initialize tracing BEFORE importing anything else
import './lib/tracing';

import express from 'express';
import { orderRoutes } from './routes/orders';
import { initKafkaProducer, initKafkaConsumer, disconnectKafka } from './lib/kafka';
import { startOutboxWorker } from './outbox/worker';
import { startConsumers } from './consumers';
import { handleTimeouts } from './saga/state-machine';
import { config } from './config';
import { logger } from './lib/logger';

const app = express();

app.use(express.json());

// Routes
app.use('/orders', orderRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'order-service',
    timestamp: new Date().toISOString(),
  });
});

// Start everything
async function start(): Promise<void> {
  try {
    // Initialize Kafka
    await initKafkaProducer();
    const consumer = await initKafkaConsumer('order-service-group');

    // Start event consumers
    await startConsumers(consumer);

    // Start outbox worker
    await startOutboxWorker();

    // Start timeout handler
    setInterval(async () => {
      try {
        await handleTimeouts();
      } catch (error) {
        logger.error({ error }, 'Timeout handler error');
      }
    }, config.timeoutCheckIntervalMs);

    // Start HTTP server
    app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Order service started');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start order service');
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('Shutting down...');
  await disconnectKafka();
  process.exit(0);
});

start();

export { app };
