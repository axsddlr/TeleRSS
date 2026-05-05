export function getTelegramErrorDescription(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err);

  const maybeErr = err as {
    response?: { description?: unknown };
    description?: unknown;
    message?: unknown;
  };

  if (typeof maybeErr.response?.description === 'string') return maybeErr.response.description;
  if (typeof maybeErr.description === 'string') return maybeErr.description;
  if (typeof maybeErr.message === 'string') return maybeErr.message;
  return String(err);
}
