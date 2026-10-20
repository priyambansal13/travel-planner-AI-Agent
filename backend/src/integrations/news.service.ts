import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchJson, fetchText, qs } from '../common/http.js';

export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

const decode = (s: string) =>
  s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();

/** Travel news & events: NewsData.io (Indian news API, country=in) → Google News India RSS fallback. */
@Injectable()
export class NewsService {
  private readonly log = new Logger(NewsService.name);
  constructor(private readonly config: ConfigService) {}

  async search(query: string, limit = 8): Promise<{ provider: string; items: NewsItem[] }> {
    const key = this.config.get<string>('NEWSDATA_API_KEY');
    if (key) {
      try {
        const data = await fetchJson(`https://newsdata.io/api/1/latest?${qs({ apikey: key, q: query, country: 'in', language: 'en' })}`, {
          ttlMs: 60 * 60_000,
        });
        const items = (data?.results ?? []).slice(0, limit).map((r: any) => ({
          title: r.title, url: r.link, source: r.source_name ?? r.source_id ?? 'NewsData.io', publishedAt: r.pubDate ?? null,
        }));
        return { provider: 'NewsData.io (India)', items };
      } catch (e) {
        this.log.warn(`NewsData.io failed, falling back to Google News India RSS: ${(e as Error).message}`);
      }
    }
    const xml = await fetchText(`https://news.google.com/rss/search?${qs({ q: `${query} when:30d`, hl: 'en-IN', gl: 'IN', ceid: 'IN:en' })}`, {
      ttlMs: 60 * 60_000,
      headers: { Accept: 'application/rss+xml' },
    });
    const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, limit).map(([, item]) => ({
      title: decode(item.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      url: decode(item.match(/<link>([\s\S]*?)<\/link>/)?.[1] ?? ''),
      source: decode(item.match(/<source[^>]*>([\s\S]*?)<\/source>/)?.[1] ?? 'Google News'),
      publishedAt: item.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? null,
    }));
    return { provider: 'Google News (India edition) RSS', items };
  }
}
