import { Router, Request, Response, IRouter } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { getSecrets, isPasswordFromEnv, updatePassword, verifyPassword } from '../auth/secrets';

export const authRouter: IRouter = Router();

const loginSchema = z.object({ password: z.string().min(1) });

authRouter.post('/login', (req: Request, res: Response) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }

  const { adminPasswordHash, jwtSecret } = getSecrets();
  if (!verifyPassword(parsed.data.password, adminPasswordHash)) {
    res.status(401).json({ error: 'Invalid password' });
    return;
  }

  const token = jwt.sign({ role: 'admin' }, jwtSecret, { expiresIn: '7d' });
  res.json({ token });
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
    res.status(401).json({ error: 'Current password is incorrect' });
    return;
  }

  try {
    updatePassword(parsed.data.newPassword);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to update password' });
  }
});
