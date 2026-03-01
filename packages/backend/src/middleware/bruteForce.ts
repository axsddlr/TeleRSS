import { Request, Response, NextFunction } from 'express';

/**
 * In-memory store for failed login attempts
 * Key: IP address or fingerprint
 * Value: { count, lastAttempt, delayMs }
 */
interface FailedAttempt {
  count: number;
  lastAttempt: number;
  delayMs: number;
}

const failedAttempts = new Map<string, FailedAttempt>();

// Configuration
const MAX_ATTEMPTS = 5; // Max attempts before exponential backoff kicks in
const BASE_DELAY_MS = 1000; // 1 second base delay
const MAX_DELAY_MS = 300_000; // 5 minutes max delay
const RESET_WINDOW_MS = 30 * 60 * 1000; // Reset after 30 minutes of no attempts

/**
 * Get client identifier (IP address)
 */
function getClientId(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || 'unknown';
}

/**
 * Calculate exponential backoff delay
 * Delay = min(BASE_DELAY * 2^(attempts - MAX_ATTEMPTS), MAX_DELAY)
 */
function calculateBackoffDelay(attempts: number): number {
  if (attempts <= MAX_ATTEMPTS) {
    return 0;
  }
  const exponent = attempts - MAX_ATTEMPTS;
  const delay = BASE_DELAY_MS * Math.pow(2, exponent);
  return Math.min(delay, MAX_DELAY_MS);
}

/**
 * Record a failed login attempt and return current delay
 */
export function recordFailedAttempt(req: Request): { delayMs: number; attempts: number } {
  const clientId = getClientId(req);
  const now = Date.now();
  
  const existing = failedAttempts.get(clientId);
  
  if (!existing || (now - existing.lastAttempt) > RESET_WINDOW_MS) {
    // Reset if no attempts in window
    failedAttempts.set(clientId, {
      count: 1,
      lastAttempt: now,
      delayMs: 0,
    });
    return { delayMs: 0, attempts: 1 };
  }
  
  // Increment attempt count
  const newCount = existing.count + 1;
  const newDelay = calculateBackoffDelay(newCount);
  
  failedAttempts.set(clientId, {
    count: newCount,
    lastAttempt: now,
    delayMs: newDelay,
  });
  
  return { delayMs: newDelay, attempts: newCount };
}

/**
 * Clear failed attempts for a client (on successful login)
 */
export function clearFailedAttempts(req: Request): void {
  const clientId = getClientId(req);
  failedAttempts.delete(clientId);
}

/**
 * Check if client is currently rate-limited due to failed attempts
 * Returns remaining delay in ms if limited, 0 if allowed
 */
export function getRemainingDelay(req: Request): { delayMs: number; attempts: number } {
  const clientId = getClientId(req);
  const now = Date.now();
  
  const existing = failedAttempts.get(clientId);
  
  if (!existing) {
    return { delayMs: 0, attempts: 0 };
  }
  
  // Reset if window expired
  if ((now - existing.lastAttempt) > RESET_WINDOW_MS) {
    failedAttempts.delete(clientId);
    return { delayMs: 0, attempts: 0 };
  }
  
  return { delayMs: existing.delayMs, attempts: existing.count };
}

/**
 * Express middleware for brute-force protection on login endpoint
 * Must be used AFTER rate limiting middleware
 */
export function bruteForceProtection(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const { delayMs, attempts } = getRemainingDelay(req);
  
  if (delayMs > 0) {
    const delaySeconds = Math.ceil(delayMs / 1000);
    
    // Log the brute force attempt
    console.warn(`[BruteForce] Blocked login attempt from ${getClientId(req)}. ` +
      `Attempt #${attempts}, delay: ${delaySeconds}s`);
    
    res.status(429).json({
      error: 'Too many failed login attempts',
      retryAfter: delaySeconds,
      message: `Please try again in ${delaySeconds} seconds`,
    });
    return;
  }
  
  // Attach attempt info to request for logging in auth handler
  (req as Request & { bruteForceAttempts?: number }).bruteForceAttempts = attempts;
  next();
}

/**
 * Cleanup old entries periodically (every hour)
 */
setInterval(() => {
  const now = Date.now();
  for (const [clientId, data] of failedAttempts.entries()) {
    if ((now - data.lastAttempt) > RESET_WINDOW_MS) {
      failedAttempts.delete(clientId);
    }
  }
}, 60 * 60 * 1000);
