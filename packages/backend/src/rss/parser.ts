import Parser from 'rss-parser';
import https from 'https';
import http from 'http';

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

function fetchUrl(url: string, redirectsLeft = 5): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib = parsed.protocol === 'https:' ? https : http;

    const req = lib.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: HEADERS },
      (res) => {
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
          reject(new Error(`HTTP ${res.statusCode} fetching feed`));
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
  const xml = await fetchUrl(url);
  const feed = await xmlParser.parseString(xml);

  const items: ParsedItem[] = (feed.items || []).map((item) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = item as any;
    const guid = item.guid || item.link || '';
    return {
      guid,
      title: item.title || 'Untitled',
      link: item.link || '',
      description: item.contentSnippet || item.content || undefined,
      pubDate: item.pubDate ? new Date(item.pubDate) : undefined,
      imageUrl: extractImageUrl(raw),
      author: (raw.creator || raw.author) as string | undefined,
    };
  });

  return {
    title: feed.title || 'Unknown Feed',
    description: feed.description || undefined,
    items,
  };
}
