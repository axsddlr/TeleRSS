import Parser from 'rss-parser';
import https from 'https';
import http from 'http';
import ipaddr from 'ipaddr.js';
import { URL } from 'url';

export interface ParsedFeed {
  title: string;
  description?: string;
  items: ParsedItem[];
}

export interface ParsedItem {
  guid: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: Date;
  imageUrl?: string;
  author?: string;
}

const xmlParser = new Parser({
  customFields: {
    item: [
      ['media:content', 'media:content'],
      ['media:thumbnail', 'media:thumbnail'],
    ],
  },
});

const HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Cache-Control': 'no-cache',
};

// Allowed MIME types for RSS/Atom feeds
const ALLOWED_CONTENT_TYPES = [
  'application/rss+xml',
  'application/atom+xml',
  'application/xml',
  'text/xml',
  'text/plain',
  'application/xml',
];

/**
 * Check if an IP address is safe to connect to (blocks private/internal IPs)
 */
function isSafeIP(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    // Only allow unicast addresses (public IPs)
    return addr.range() === 'unicast';
  } catch {
    return false;
  }
}

/**
 * Validate that a URL does not point to internal/private resources
 */
function validateUrlSafety(url: string): boolean {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname;

    // Skip validation for non-IP hostnames (they'll be resolved later)
    if (!ipaddr.isValid(hostname)) {
      return true;
    }

    return isSafeIP(hostname);
  } catch {
    return false;
  }
}

class FetchHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly retryAfterMs?: number,
  ) {
    super(`HTTP ${statusCode} fetching feed`);
    this.name = 'FetchHttpError';
  }
}

function fetchUrl(url: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    // Validate URL safety on initial request and each redirect
    if (!validateUrlSafety(url)) {
      reject(new Error('URL points to internal/private network'));
      return;
    }

    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: HEADERS },
      (res) => {
        // Validate Content-Type to prevent XML injection attacks
        const contentType = res.headers['content-type']?.toLowerCase() ?? '';
        const isAllowedType = ALLOWED_CONTENT_TYPES.some(type => contentType.includes(type));
        if (!isAllowedType && res.statusCode === 200) {
          reject(new Error(`Invalid content type: ${contentType}`));
          return;
        }

        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          if (redirectsLeft === 0) {
            reject(new Error('Too many redirects'));
            return;
          }
          const next = new URL(res.headers.location, url).toString();
          resolve(fetchUrl(next, redirectsLeft - 1));
          return;
        }

        if (res.statusCode && res.statusCode >= 400) {
          let retryAfterMs: number | undefined;
          const retryAfter = res.headers['retry-after'];
          if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            retryAfterMs = isNaN(seconds) ? undefined : seconds * 1000;
          }
          reject(new FetchHttpError(res.statusCode, retryAfterMs));
          return;
        }

        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
        res.on('error', reject);
      }
    );

    req.setTimeout(10000, () => {
      req.destroy(new Error('Request timed out'));
    });
    req.on('error', reject);
  });
}

async function fetchUrlWithRetry(url: string): Promise<string> {
  const MAX_ATTEMPTS = 3;
  const BASE_DELAY_MS = 5000;
  const MAX_DELAY_MS = 60000;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchUrl(url);
    } catch (err) {
      const isRetryable =
        err instanceof FetchHttpError &&
        (err.statusCode === 429 || err.statusCode === 503);

      if (!isRetryable || attempt === MAX_ATTEMPTS) {
        throw err;
      }

      const backoff = Math.min(BASE_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
      const delayMs = (err as FetchHttpError).retryAfterMs ?? backoff;
      console.warn(
        `Feed fetch got ${(err as FetchHttpError).statusCode} (attempt ${attempt}/${MAX_ATTEMPTS}). Retrying in ${delayMs}ms…`,
      );
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error('fetchUrlWithRetry exhausted attempts');
}

function safeUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : undefined;
  } catch {
    return undefined;
  }
}

function extractFirstImage(html: string): string | undefined {
  const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  const url = match?.[1];
  // Skip tiny tracking pixels and data URIs
  if (!url || url.startsWith('data:') || url.includes('pixel') || url.includes('tracking')) {
    return undefined;
  }
  return url;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractImageUrl(item: any): string | undefined {
  // 1. Enclosure (podcasts, video feeds, image feeds)
  if (item.enclosure?.url) return item.enclosure.url as string;

  // 2. media:content — can be object or array
  const mc = item['media:content'];
  if (mc) {
    const first = Array.isArray(mc) ? mc[0] : mc;
    const url: string | undefined = first?.$?.url ?? first?.url;
    if (url) return url;
  }

  // 3. media:thumbnail
  const mt = item['media:thumbnail'];
  if (mt?.$?.url) return mt.$?.url as string;

  // 4. First <img> in full HTML content
  const html: string = item['content:encoded'] ?? item.content ?? '';
  if (html) return extractFirstImage(html);

  return undefined;
}

export async function parseFeed(url: string): Promise<ParsedFeed> {
  const xml = await fetchUrlWithRetry(url);
  const feed = await xmlParser.parseString(xml);

  const items: ParsedItem[] = (feed.items || []).map((item) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = item as any;
    const guid = item.guid || item.link || '';
    return {
      guid,
      title: item.title || 'Untitled',
      link: safeUrl(item.link) ?? '',
      description: item.contentSnippet || item.content || undefined,
      pubDate: item.pubDate ? new Date(item.pubDate) : undefined,
      imageUrl: safeUrl(extractImageUrl(raw)),
      author: (raw.creator || raw.author) as string | undefined,
    };
  });

  return {
    title: feed.title || 'Unknown Feed',
    description: feed.description || undefined,
    items,
  };
}
