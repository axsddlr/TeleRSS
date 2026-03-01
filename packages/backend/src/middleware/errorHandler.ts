import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Global error handler middleware
 * 
 * Catches all errors and returns sanitized responses to prevent
 * leaking internal implementation details, stack traces, or
 * sensitive information.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log full error for debugging (server-side only)
  console.error('Error:', {
    name: err.name,
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Handle Prisma-specific errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Don't expose database schema details
    res.status(500).json({ error: 'Database error occurred' });
    return;
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    res.status(400).json({ error: 'Invalid request data' });
    return;
  }

  // Handle Zod validation errors (from API input validation)
  if (err.name === 'ZodError') {
    res.status(400).json({ error: 'Invalid request data' });
    return;
  }

  // Handle JSON parsing errors
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: 'Invalid JSON in request body' });
    return;
  }

  // Handle file size limits
  if (err.message.includes('too large') || err.message.includes('limit')) {
    res.status(413).json({ error: 'Request too large' });
    return;
  }

  // Default error response - generic message, no internals
  const statusCode = res.statusCode !== 200 ? res.statusCode : 500;
  res.status(statusCode).json({
    error: statusCode === 500 ? 'Internal server error' : err.message,
  });
}

/**
 * 404 Not Found handler
 */
export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}
