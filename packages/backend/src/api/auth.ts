import { Router, Request, Response, IRouter } from 'express';
import rateLimit from 'express-rate-limit';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getSecrets, isPasswordFromEnv, updatePassword, verifyPassword } from '../auth/secrets';
import { auditLog, createAuditEvent, getClientIP } from '../audit/logger';
import { bruteForceProtection, recordFailedAttempt, clearFailedAttempts } from '../middleware/bruteForce';

export const authRouter: IRouter = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later' },
  handler: (req: Request, res: Response) => {
    // Audit log rate-limited login attempts
    auditLog(createAuditEvent(
      'security.rate_limit',
      req,
      'blocked',
      { resourceType: 'auth', details: { reason: 'login_rate_limit' } }
    ));
    res.status(429).json({ error: 'Too many login attempts, please try again later' });
  },
});

const loginSchema = z.object({ password: z.string().min(1) });

// Cookie configuration for secure JWT storage
const COOKIE_OPTIONS: CookieSerializeOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production', // HTTPS only in production
  sameSite: 'strict',
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  path: '/',
};

interface CookieSerializeOptions {
  httpOnly: boolean;
  secure?: boolean;
  sameSite: 'strict' | 'lax' | 'none';
  maxAge: number;
  path: string;
}

authRouter.post('/login', loginLimiter, bruteForceProtection, (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  const { adminPasswordHash, jwtSecret } = getSecrets();
  if (!verifyPassword(parsed.data.password, adminPasswordHash)) {
    // Record failed attempt with exponential backoff
    const { delayMs, attempts } = recordFailedAttempt(req);
    
    // Audit log failed login attempt
    auditLog(createAuditEvent(
      'auth.login.failure',
      req,
      'failure',
      { 
        resourceType: 'auth', 
        details: { 
          reason: 'invalid_password',
          attemptNumber: attempts,
          delayApplied: delayMs > 0,
        } 
      }
    ));
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  // Clear failed attempts on successful login
  clearFailedAttempts(req);

  // Audit log successful login
  auditLog(createAuditEvent(
    'auth.login.success',
    req,
    'success',
    { resourceType: 'auth' }
  ));

  const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '7d' });

  // Set JWT as httpOnly cookie (not accessible via JavaScript)
  res.cookie('auth_token', token, COOKIE_OPTIONS);
  res.json({ ok: true });
});

// Logout endpoint to clear the cookie
authRouter.post('/logout', (req: Request, res: Response) => {
  // Audit log logout
  auditLog(createAuditEvent(
    'auth.logout',
    req,
    'success',
    { resourceType: 'auth' }
  ));
  res.clearCookie('auth_token', { path: '/' });
  res.json({ ok: true });
});

// Protected routes (requireAuth is applied in router.ts before these are mounted)
export const authProtectedRouter: IRouter = Router();

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
});

authProtectedRouter.get('/status', (_req: Request, res: Response) => {
  res.json({ passwordFromEnv: isPasswordFromEnv() });
});

authProtectedRouter.post('/change-password', (req: Request, res: Response) => {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0].message });
    return;
  }

  const { adminPasswordHash } = getSecrets();
  if (!verifyPassword(parsed.data.currentPassword, adminPasswordHash)) {
    // Audit log failed password change attempt
    auditLog(createAuditEvent(
      'auth.password.change',
      req,
      'failure',
      { resourceType: 'auth', details: { reason: 'invalid_current_password' } }
    ));
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  try {
    updatePassword(parsed.data.newPassword);
    // Audit log successful password change
    auditLog(createAuditEvent(
      'auth.password.change',
      req,
      'success',
      { resourceType: 'auth', details: { passwordChanged: true } }
    ));
    res.json({ ok: true });
  } catch (e) {
    // Audit log password change failure
    auditLog(createAuditEvent(
      'auth.password.change',
      req,
      'failure',
      { resourceType: 'auth', details: { reason: 'save_error' } }
    ));
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to update password' });
  }
});
