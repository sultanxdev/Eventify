// Initialize tracing BEFORE importing anything else
import './lib/tracing';

import express from 'express';
import { authRoutes } from './routes/auth';
import { config } from './config';
import { logger } from './lib/logger';

const app = express();

// Middleware
app.use(express.json());

// Routes
app.use('/auth', authRoutes);

// Health check
app.get('/health', (_req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'auth-service',
    timestamp: new Date().toISOString(),
  });
});

// Start server
app.listen(config.port, () => {
  logger.info({ port: config.port }, 'Auth service started');
});

export { app };
