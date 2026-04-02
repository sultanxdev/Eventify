import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

/**
 * Injects a correlation ID into every request.
 * If the client sends X-Correlation-ID, we use it.
 * Otherwise, we generate a new UUID.
 */
export function correlationIdMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!req.headers['x-correlation-id']) {
    req.headers['x-correlation-id'] = uuidv4();
  }
  next();
}
