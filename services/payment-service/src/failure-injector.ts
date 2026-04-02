import { config } from './config';
import { logger } from './lib/logger';

/**
 * Failure Injector — Simulates real-world production failures
 * 
 * This is the KEY DIFFERENTIATOR of this project.
 * It proves the system handles failures correctly, not just happy paths.
 */

export interface FailureResult {
  shouldFail: boolean;
  shouldCrash: boolean;
  delayMs: number;
  shouldDuplicate: boolean;
  reason?: string;
}

export function checkFailureInjection(orderId: string): FailureResult {
  const log = logger.child({ orderId, component: 'failure-injector' });

  const result: FailureResult = {
    shouldFail: false,
    shouldCrash: false,
    delayMs: 0,
    shouldDuplicate: false,
  };

  // 1. Random failure
  if (config.paymentFailureRate > 0) {
    const random = Math.random();
    if (random < config.paymentFailureRate) {
      result.shouldFail = true;
      result.reason = `Random failure (rate: ${config.paymentFailureRate}, rolled: ${random.toFixed(3)})`;
      log.warn({ failureRate: config.paymentFailureRate, roll: random }, 'FAILURE INJECTED: Random payment failure');
    }
  }

  // 2. Timeout simulation
  if (config.paymentTimeoutMs > 0) {
    result.delayMs = config.paymentTimeoutMs;
    log.warn({ delayMs: result.delayMs }, 'FAILURE INJECTED: Payment delay');
  }

  // 3. Crash mode
  if (config.paymentCrashMode) {
    result.shouldCrash = true;
    log.warn('FAILURE INJECTED: Service will crash mid-processing');
  }

  // 4. Duplicate event mode
  if (config.duplicateEventMode) {
    result.shouldDuplicate = true;
    log.warn('FAILURE INJECTED: Response event will be published twice');
  }

  return result;
}

/**
 * Apply delay if configured.
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
