import type { Block } from '../fixtures/real-doc-content';

const API = 'https://vi.wikipedia.org/w/api.php';
const UA = 'CognivaEdu/1.0 (https://cogniva.dev; educational use)';

type WikiArticle = { title: string; extract: string; url: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api<T>(params: Record<string, string>, retry = 3): Promise<T> {
  const qs = new URLSearchParams({ format: 'json', ...params });
  for (let attempt = 0; attempt <= retry; attempt++) {
    const res = await fetch(`${API}?${qs}`, { headers: { 'User-Agent': UA } });
    const text = await res.text();
    if (!res.ok || text.startsWith('You are making too many')) {
      if (attempt < retry) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      throw new Error(`wiki ${res.status} rate-limited`);
    }
    return JSON.parse(text) as T;
  }
  throw new Error('wiki: hết retry');
}

export async function fetchArticle(title: string): Promise<WikiArticle | null> {
  type Resp = {
    query?: { pages?: Record<string, { title: string; extract?: string; missing?: string }> };
  };
  const j = await api<Resp>({
    action: 'query',
    prop: 'extracts',
    explaintext: '1',
    redirects: '1',
    titles: title,
  });
  const page = Object.values(j.query?.pages ?? {})[0];
  if (!page || page.missing !== undefined) return null;
  const extract = (page.extract ?? '').trim();
  if (extract.length < 600) return null;
  return {
    title: page.title,
    extract,
    url: `https://vi.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, '_'))}`,
  };
}

type CMResp = { query?: { categorymembers?: Array<{ title: string; ns: number }> } };

async function rawMembers(
  category: string,
  type: 'page' | 'subcat',
  limit: number,
): Promise<string[]> {
  const j = await api<CMResp>({
    action: 'query',
    list: 'categorymembers',
    cmtitle: category.startsWith('Thể loại:') ? category : `Thể loại:${category}`,
    cmlimit: String(Math.min(limit, 500)),
    cmtype: type,
  });
  return (j.query?.categorymembers ?? []).map((m) => m.title);
}

export async function fetchCategoryMembers(category: string, limit = 200): Promise<string[]> {
  const titles = new Set<string>(await rawMembers(category, 'page', limit));
  if (titles.size < limit) {
    const subcats = await rawMembers(category, 'subcat', 20);
    for (const sub of subcats) {
      if (titles.size >= limit) break;
      await sleep(120);
      try {
        for (const t of await rawMembers(sub, 'page', limit)) {
          titles.add(t);
          if (titles.size >= limit) break;
        }
      } catch {}
    }
  }
  return [...titles];
}

export function articleToBlocks(art: WikiArticle, maxParas = 24): Block[] {
  const blocks: Block[] = [];
  const lines = art.extract
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  let paras = 0;
  for (const line of lines) {
    if (paras >= maxParas) break;
    const isHeading =
      line.length < 70 &&
      !/[.!?:;,]$/.test(line) &&
      !/^\d/.test(line) &&
      line.split(' ').length <= 8;
    if (isHeading) {
      blocks.push({ type: 'h', text: line });
    } else {
      blocks.push({ type: 'p', text: line.slice(0, 1500) });
      paras++;
    }
  }

  blocks.push({ type: 'h', text: 'Nguồn' });
  blocks.push({
    type: 'p',
    text: `Nội dung trích từ Wikipedia tiếng Việt — bài "${art.title}" (${art.url}), giấy phép CC BY-SA 4.0. Cogniva biên tập lại cho mục đích học tập.`,
  });
  return blocks;
}

export function articlePlain(art: WikiArticle): string {
  return art.extract.replace(/\s+/g, ' ').slice(0, 600);
}
