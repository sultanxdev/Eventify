import { Router, Request, Response } from 'express';
import { config } from '../config';
import { logger } from '../lib/logger';

const router = Router();

/**
 * Proxy helper — forwards request to a downstream service.
 */
async function proxyRequest(
  req: Request,
  res: Response,
  targetUrl: string,
  path: string
): Promise<void> {
  const correlationId = req.headers['x-correlation-id'] as string;
  const log = logger.child({ correlationId, target: targetUrl, path });

  try {
    const url = `${targetUrl}${path}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-correlation-id': correlationId,
    };

    // Forward auth-related headers
    if (req.headers['x-user-id']) {
      headers['x-user-id'] = req.headers['x-user-id'] as string;
    }
    if (req.headers['x-user-email']) {
      headers['x-user-email'] = req.headers['x-user-email'] as string;
    }
    if (req.headers['idempotency-key']) {
      headers['idempotency-key'] = req.headers['idempotency-key'] as string;
    }

    const fetchOptions: RequestInit = {
      method: req.method,
      headers,
    };

    if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
      fetchOptions.body = JSON.stringify(req.body);
    }

    log.info({ method: req.method }, 'Proxying request');

    const response = await fetch(url, fetchOptions);
    const data = await response.json();

    res.status(response.status).json(data);
  } catch (error) {
    log.error({ error }, 'Proxy request failed');
    res.status(502).json({
      error: 'BAD_GATEWAY',
      message: 'Downstream service unavailable',
      correlationId,
    });
  }
}

// ============================================
// AUTH ROUTES (public)
// ============================================

router.post('/auth/signup', (req, res) => {
  proxyRequest(req, res, config.authServiceUrl, '/auth/signup');
});

router.post('/auth/login', (req, res) => {
  proxyRequest(req, res, config.authServiceUrl, '/auth/login');
});

// ============================================
// ORDER ROUTES (protected — JWT validated by middleware)
// ============================================

router.post('/orders', (req, res) => {
  proxyRequest(req, res, config.orderServiceUrl, '/orders');
});

router.get('/orders/:id', (req, res) => {
  proxyRequest(req, res, config.orderServiceUrl, `/orders/${req.params.id}`);
});

// ============================================
// HEALTH CHECK (aggregated)
// ============================================

router.get('/health', async (req: Request, res: Response) => {
  const services = [
    { name: 'auth-service', url: config.authServiceUrl },
    { name: 'order-service', url: config.orderServiceUrl },
    { name: 'inventory-service', url: config.inventoryServiceUrl },
  ];

  const results: Record<string, string> = {
    'api-gateway': 'healthy',
  };

  for (const service of services) {
    try {
      const response = await fetch(`${service.url}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      results[service.name] = response.ok ? 'healthy' : 'unhealthy';
    } catch {
      results[service.name] = 'unhealthy';
    }
  }

  const allHealthy = Object.values(results).every(s => s === 'healthy');

  res.status(allHealthy ? 200 : 503).json({
    status: allHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    services: results,
  });
});

export { router as routes };
