export const config = {
  port: parseInt(process.env.PORT || '3002', 10),
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  sagaTimeoutMs: parseInt(process.env.SAGA_TIMEOUT_MS || '30000', 10),
  outboxPollIntervalMs: parseInt(process.env.OUTBOX_POLL_INTERVAL_MS || '1000', 10),
  timeoutCheckIntervalMs: parseInt(process.env.TIMEOUT_CHECK_INTERVAL_MS || '10000', 10),
};
