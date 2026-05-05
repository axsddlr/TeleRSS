export interface ArticleData {
  feedName: string;
  title: string;
  link: string;
  description?: string;
  pubDate?: Date | string;
  imageUrl?: string;
  author?: string;
}

export interface FormattedArticle {
  /** Full-length HTML message text (for sendMessage) */
  text: string;
  /** Shorter caption for sendPhoto (≤ 1024 chars) */
  caption: string;
  imageUrl?: string;
  link: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength).trimEnd() + '…';
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

function truncateHtml(html: string, maxLength: number): string {
  if (html.length <= maxLength) return html;

  const slice = html.slice(0, maxLength);
  const lastTagEnd = slice.lastIndexOf('>');
  if (lastTagEnd === -1) return slice + '…';

  let result = slice.slice(0, lastTagEnd + 1);

  const openTags: string[] = [];
  const tagPattern = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
  let m;
  while ((m = tagPattern.exec(result)) !== null) {
    if (m[0].startsWith('</')) {
      if (openTags.length > 0 && openTags[openTags.length - 1] === m[1]) {
        openTags.pop();
      }
    } else if (!m[0].endsWith('/>')) {
      openTags.push(m[1]);
    }
  }

  for (let i = openTags.length - 1; i >= 0; i--) {
    result += `</${openTags[i]}>`;
  }

  return result + '…';
}

function cleanDescription(text: string): string {
  return text
    .replace(/submitted by\s+\/?u\/\S+/gi, '')  // Reddit "submitted by /u/name"
    .replace(/\[link\]/gi, '')                    // Reddit [link]
    .replace(/\[comments\]/gi, '')                // Reddit [comments]
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function formatDate(date?: Date | string): string {
  const d = date ? new Date(date) : new Date();
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatArticleMessage(article: ArticleData): FormattedArticle {
  const title = escapeHtml(article.title);
  const feedName = escapeHtml(article.feedName);
  const link = article.link;
  const date = formatDate(article.pubDate);

  const plainDesc = article.description ? cleanDescription(stripHtml(article.description)) : '';

  // Header: feed name only
  const header = `<blockquote>📰 <b>${feedName}</b></blockquote>`;

  // Footer: author + date (feed name removed — it's now at the top)
  const footer = article.author
    ? `${escapeHtml(article.author)} · <i>${date}</i>`
    : `<i>${date}</i>`;

  // Full message (for text-only send, link preview will supply the image)
  // Title is plain text (not hyperlinked) since "Read more" button provides the link
  const descFull = plainDesc ? `\n\n${escapeHtml(truncate(plainDesc, 300))}` : '';
  const text = `${header}\n<b>${title}</b>${descFull}\n\n${footer}`;

  // Caption (for sendPhoto — max 1024 chars, keep it tight)
  // Title is plain text (not hyperlinked) since inline keyboard provides the link
  const descCaption = plainDesc ? `\n\n${escapeHtml(truncate(plainDesc, 180))}` : '';
  const captionRaw = `${header}\n<b>${title}</b>${descCaption}\n\n${footer}`;
  // Trim caption to Telegram's 1024-char limit, preserving HTML tag boundaries
  const caption = truncateHtml(captionRaw, 1024);

  return { text, caption, imageUrl: article.imageUrl, link };
}
