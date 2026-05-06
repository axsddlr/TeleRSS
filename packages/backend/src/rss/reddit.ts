import { URL } from 'url';

const REDDIT_HOSTS = ['reddit.com', 'www.reddit.com', 'old.reddit.com'];
const REDDIT_API_BASE = 'https://old.reddit.com';
const REDDIT_WEB_BASE = 'https://www.reddit.com';

function isRedditUrl(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return REDDIT_HOSTS.some((h) => hostname === h || hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}

function convertToJsonUrl(url: string): string {
  const parsed = new URL(url);
  const apiUrl = REDDIT_API_BASE + parsed.pathname + parsed.search;
  return apiUrl
    .replace(/\.rss(\?|$)/, '.json$1')
    .replace('search.rss', 'search.json');
}

interface RedditPost {
  title: string;
  permalink: string;
  selftext?: string;
  created_utc: number;
  name: string;
  author: string;
  url?: string;
}

function redditJsonToRssXml(
  feedTitle: string,
  feedUrl: string,
  posts: RedditPost[],
): string {
  const items = posts
    .map((p) => {
      const link = REDDIT_WEB_BASE + p.permalink;
      const guid = p.name;
      const pubDate = new Date(p.created_utc * 1000).toUTCString();
      const author = escapeXml(p.author);
      const title = escapeXml(p.title);
      const description = p.selftext ? escapeXml(p.selftext.substring(0, 500)) : '';

      let imageTag = '';
      if (p.url && /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(p.url)) {
        imageTag = `<media:content url="${escapeXml(p.url)}" />`;
      }

      return `<item>
      <title>${title}</title>
      <link>${escapeXml(link)}</link>
      <description>${description}</description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
      <author>${author}</author>
      ${imageTag}
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml(feedTitle)}</title>
    <link>${escapeXml(feedUrl)}</link>
    <description>Reddit feed</description>
    ${items}
  </channel>
</rss>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function tryAdaptRedditFeed(url: string): string | null {
  if (!isRedditUrl(url)) return null;

  const jsonUrl = convertToJsonUrl(url);
  if (jsonUrl === url) return null;

  return jsonUrl;
}

interface RedditResponse {
  data?: {
    children?: Array<{ data: RedditPost }>;
  };
}

export async function fetchAndConvertRedditFeed(jsonUrl: string): Promise<string> {
  const response = await fetch(jsonUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Reddit API returned ${response.status}`);
  }

  const data = await response.json() as RedditResponse;
  const children = data?.data?.children ?? [];

  const posts: RedditPost[] = children
    .map((c: { data: RedditPost }) => c.data)
    .filter((p: RedditPost) => p && p.name);

  const feedTitle = extractFeedTitle(jsonUrl);
  const feedUrl = REDDIT_WEB_BASE + '/' + extractSubredditPath(jsonUrl);

  return redditJsonToRssXml(feedTitle, feedUrl, posts);
}

function extractFeedTitle(jsonUrl: string): string {
  const match = jsonUrl.match(/\/r\/([^/]+)/);
  return match ? `r/${match[1]}` : 'Reddit';
}

function extractSubredditPath(jsonUrl: string): string {
  const match = jsonUrl.match(/\/r\/([^/]+)/);
  return match ? `r/${match[1]}` : '';
}
