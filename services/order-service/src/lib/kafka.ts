import { Kafka, Producer, Consumer, logLevel } from 'kafkajs';
import { config } from '../config';
import { logger } from './logger';

const kafka = new Kafka({
  clientId: 'order-service',
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
  producer = kafka.producer({
    allowAutoTopicCreation: true,
    idempotent: true,
  });
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
  if (!producer) throw new Error('Kafka producer not initialized');
  return producer;
}

export function getConsumer(): Consumer {
  if (!consumer) throw new Error('Kafka consumer not initialized');
  return consumer;
}

export async function disconnectKafka(): Promise<void> {
  if (producer) await producer.disconnect();
  if (consumer) await consumer.disconnect();
  logger.info('Kafka disconnected');
}

export { kafka };
