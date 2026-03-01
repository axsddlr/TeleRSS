/**
 * Audit Logger for Security Events
 * 
 * Logs security-relevant events with structured data for:
 * - Authentication attempts (success/failure)
 * - Password changes
 * - Feed operations (create, update, delete)
 * - Subscription operations
 * - Bot configuration changes
 * 
 * Format: JSON lines for easy parsing by log aggregators
 */

export type AuditEventType =
  | 'auth.login.success'
  | 'auth.login.failure'
  | 'auth.logout'
  | 'auth.password.change'
  | 'auth.password.reset'
  | 'feed.create'
  | 'feed.update'
  | 'feed.delete'
  | 'feed.refresh'
  | 'subscription.create'
  | 'subscription.update'
  | 'subscription.delete'
  | 'bot.chats.sync'
  | 'security.rate_limit'
  | 'security.error';

export interface AuditEvent {
  timestamp: string;
  eventType: AuditEventType;
  actor: {
    ip: string;
    userAgent?: string;
    userId?: string;
  };
  resource?: {
    type: string;
    id?: string;
    name?: string;
  };
  outcome: 'success' | 'failure' | 'blocked';
  details?: Record<string, unknown>;
}

/**
 * Log an audit event to stdout (structured JSON)
 * In production, these logs should be shipped to a SIEM or log aggregator
 */
export function auditLog(event: AuditEvent): void {
  const logEntry = JSON.stringify({
    ...event,
    timestamp: event.timestamp || new Date().toISOString(),
  });

  // Use console.warn for audit logs to separate from application logs
  // This makes it easier to filter and ship to security monitoring systems
  console.warn(`[AUDIT] ${logEntry}`);
}

/**
 * Helper to extract client IP from Express request
 * Handles X-Forwarded-For header for proxied requests
 */
export function getClientIP(req: { headers: Record<string, string | string[] | undefined> }): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    return value.split(',')[0].trim();
  }
  const realIp = req.headers['x-real-ip'];
  return (Array.isArray(realIp) ? realIp[0] : realIp) ?? 'unknown';
}

/**
 * Create audit event helper
 */
export function createAuditEvent(
  eventType: AuditEventType,
  req: { headers: Record<string, string | string[] | undefined> },
  outcome: AuditEvent['outcome'],
  options?: {
    userId?: string;
    resourceType?: string;
    resourceId?: string;
    resourceName?: string;
    details?: Record<string, unknown>;
  }
): AuditEvent {
  return {
    timestamp: new Date().toISOString(),
    eventType,
    actor: {
      ip: getClientIP(req),
      userAgent: [req.headers['user-agent']].flat()[0],
      userId: options?.userId,
    },
    resource: options?.resourceType
      ? {
          type: options.resourceType,
          id: options.resourceId,
          name: options.resourceName,
        }
      : undefined,
    outcome,
    details: options?.details,
  };
}
