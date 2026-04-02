export const config = {
  port: parseInt(process.env.PORT || '3004', 10),
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
  
  // Failure injection configuration
  paymentFailureRate: parseFloat(process.env.PAYMENT_FAILURE_RATE || '0'),
  paymentTimeoutMs: parseInt(process.env.PAYMENT_TIMEOUT_MS || '0', 10),
  paymentCrashMode: process.env.PAYMENT_CRASH_MODE === 'true',
  duplicateEventMode: process.env.DUPLICATE_EVENT_MODE === 'true',
};
