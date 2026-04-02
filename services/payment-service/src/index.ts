// Initialize tracing BEFORE importing anything else
import './lib/tracing';

import express from 'express';
import { initKafkaProducer, initKafkaConsumer, disconnectKafka } from './lib/kafka';
import { startConsumers } from './consumers';
import { config } from './config';
import { logger } from './lib/logger';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'payment-service',
    timestamp: new Date().toISOString(),
    failureConfig: {
      failureRate: config.paymentFailureRate,
      timeoutMs: config.paymentTimeoutMs,
      crashMode: config.paymentCrashMode,
      duplicateEventMode: config.duplicateEventMode,
    },
  });
});

async function start(): Promise<void> {
  try {
    // Log failure injection settings on startup
    logger.info({
      failureRate: config.paymentFailureRate,
      timeoutMs: config.paymentTimeoutMs,
      crashMode: config.paymentCrashMode,
      duplicateEventMode: config.duplicateEventMode,
    }, '⚙️  Failure injection configuration');

    await initKafkaProducer();
    const consumer = await initKafkaConsumer('payment-service-group');
    await startConsumers(consumer);

    app.listen(config.port, () => {
      logger.info({ port: config.port }, 'Payment service started');
    });
  } catch (error) {
    logger.error({ error }, 'Failed to start payment service');
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  await disconnectKafka();
  process.exit(0);
});

start();
export { app };
