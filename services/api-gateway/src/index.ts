// Initialize tracing BEFORE importing anything else
import './lib/tracing';

import express from 'express';
import { routes } from './routes';
import { correlationIdMiddleware } from './middleware/correlation-id';
import { authMiddleware } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/rate-limit';
import { config } from './config';
import { logger } from './lib/logger';

const app = express();

// Middleware (order matters)
app.use(express.json());
app.use(correlationIdMiddleware);
app.use(rateLimitMiddleware(config.rateLimitWindowMs, config.rateLimitMax));
app.use(authMiddleware);

// Routes
app.use('/', routes);

// Start server
app.listen(config.port, () => {
  logger.info({ port: config.port }, 'API Gateway started');
});

export { app };
