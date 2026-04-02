import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';
import { config } from '../config';
import { logger } from './logger';

const kafka = new Kafka({
  clientId: 'inventory-service',
  brokers: config.kafkaBrokers,
  logLevel: logLevel.WARN,
  retry: {
    initialRetryTime: 1000,
    retries: 10,
  },
});

let producer: Producer;
let consumer: Consumer;

export async function initKafkaProducer(): Promise<Producer> {
  producer = kafka.producer({ allowAutoTopicCreation: true });
  await producer.connect();
  logger.info('Kafka producer connected');
  return producer;
}

export async function initKafkaConsumer(groupId: string): Promise<Consumer> {
  consumer = kafka.consumer({ groupId });
  await consumer.connect();
  logger.info({ groupId }, 'Kafka consumer connected');
  return consumer;
}

export function getProducer(): Producer {
  return producer;
}

export async function disconnectKafka(): Promise<void> {
  if (producer) await producer.disconnect();
  if (consumer) await consumer.disconnect();
}

export { kafka };
