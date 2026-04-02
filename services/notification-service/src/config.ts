export const config = {
  port: parseInt(process.env.PORT || '3005', 10),
  kafkaBrokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
};
