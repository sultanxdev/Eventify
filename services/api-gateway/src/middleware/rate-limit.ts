import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

/**
 * Simple in-memory rate limiter.
 * Limits requests per IP within a time window.
 */
export function rateLimitMiddleware(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const entry = store.get(ip);

    if (!entry || now > entry.resetAt) {
      store.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    if (entry.count >= maxRequests) {
      const correlationId = req.headers['x-correlation-id'] as string;
      logger.warn({ ip, correlationId }, 'Rate limit exceeded');
      res.status(429).json({
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
        correlationId,
      });
      return;
    }

    entry.count++;
    next();
  };
}
