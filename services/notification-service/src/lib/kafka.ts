import { Kafka, Consumer, logLevel } from 'kafkajs';
import { config } from '../config';
import { logger } from './logger';

const kafka = new Kafka({
  clientId: 'notification-service',
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN,
  retry: { initialRetryTime: 1000, retries: 10 },
});

let consumer: Consumer;

export async function initKafkaConsumer(groupId: string): Promise<Consumer> {
  consumer = kafka.consumer({ groupId });
  await consumer.connect();
  logger.info({ groupId }, 'Kafka consumer connected');
  return consumer;
}

export async function disconnectKafka(): Promise<void> {
  if (consumer) await consumer.disconnect();
}
