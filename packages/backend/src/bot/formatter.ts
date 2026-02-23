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
  const descFull = plainDesc ? `\n\n${escapeHtml(truncate(plainDesc, 300))}` : '';
  const text = `${header}\n<b><a href="${link}">${title}</a></b>${descFull}\n\n${footer}`;

  // Caption (for sendPhoto — max 1024 chars, keep it tight)
  const descCaption = plainDesc ? `\n\n${escapeHtml(truncate(plainDesc, 180))}` : '';
  const captionRaw = `${header}\n<b><a href="${link}">${title}</a></b>${descCaption}\n\n${footer}`;
  // Trim caption to Telegram's 1024-char limit
  const caption =
    captionRaw.length <= 1024 ? captionRaw : captionRaw.slice(0, 1020).trimEnd() + '…';

  return { text, caption, imageUrl: article.imageUrl, link };
}
