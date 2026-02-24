import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { getSecrets } from '../auth/secrets';

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    jwt.verify(authHeader.slice(7), getSecrets().jwtSecret);
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized' });
  }
}
