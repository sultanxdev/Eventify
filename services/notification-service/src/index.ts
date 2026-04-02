// Initialize tracing BEFORE importing anything else
import './lib/tracing';

import express from 'express';
import { initKafkaConsumer, disconnectKafka } from './lib/kafka';
import { startConsumers } from './consumers';
import { config } from './config';
import { logger } from './lib/logger';

const app = express();

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'notification-service',
    timestamp: new Date().toISOString(),
  });
});

async function start(): Promise<void> {
  try {
    const consumer = await initKafkaConsumer('notification-service-group');
    await startConsumers(consumer);

    app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Notification service started');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start notification service');
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await disconnectKafka();
  process.exit(0);
});

start();
export { app };
