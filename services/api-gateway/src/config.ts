export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  authServiceUrl: process.env.AUTH_SERVICE_URL || 'http://localhost:3001',
  orderServiceUrl: process.env.ORDER_SERVICE_URL || 'http://localhost:3002',
  inventoryServiceUrl: process.env.INVENTORY_SERVICE_URL || 'http://localhost:3003',
  jwtSecret: process.env.JWT_SECRET || 'eventify-super-secret-jwt-key-change-in-production',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
};
