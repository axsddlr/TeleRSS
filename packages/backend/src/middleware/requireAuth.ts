import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSecrets } from '../auth/secrets';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  let token: string | undefined;

  // Try to get token from httpOnly cookie first
  if (req.cookies?.auth_token) {
    token = req.cookies.auth_token;
  } else {
    // Fallback to Authorization header for API clients
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7);
    }
  }

  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  try {
    jwt.verify(token, getSecrets().jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
