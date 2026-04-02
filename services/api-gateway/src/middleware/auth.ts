import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { logger } from '../lib/logger';

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

/**
 * JWT authentication middleware.
 * Validates Bearer token and attaches user info to request.
 */
export function authMiddleware(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const correlationId = req.headers['x-correlation-id'] as string;

  // Skip auth for public routes
  const publicPaths = ['/auth/', '/health'];
  if (publicPaths.some(path => req.path.startsWith(path))) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing or invalid Authorization header',
      correlationId,
    });
    return;
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwtSecret) as { userId: string; email: string };
    req.user = decoded;
    // Forward user info as headers to downstream services
    req.headers['x-user-id'] = decoded.userId;
    req.headers['x-user-email'] = decoded.email;
    next();
  } catch (error) {
    logger.warn({ correlationId, error }, 'JWT verification failed');
    res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
      correlationId,
    });
  }
}
