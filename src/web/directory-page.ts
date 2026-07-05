import type { DirectoryResult } from '../query.js';
import { agoHtml, esc, pageShell, starsHtml, toolHref } from './shared.js';

const CSS = `
  .head { padding: 44px 0 8px; }
  h1 { font-size: 30px; letter-spacing: -.5px; }
  .lede { color: var(--dim); margin-top: 8px; max-width: 720px; }
  form.search { display: flex; gap: 10px; margin: 22px 0 8px; flex-wrap: wrap; }
  form.search input[type=search] {
    flex: 1; min-width: 240px; background: var(--panel); color: var(--text);
    border: 1px solid var(--border2); border-radius: 8px; padding: 10px 14px; font: inherit;
  }
  form.search button { background: linear-gradient(92deg,#1f6feb,#388bfd); color: #fff; border: none; border-radius: 8px; padding: 10px 20px; font: inherit; font-weight: 600; cursor: pointer; }
  .cats { display: flex; gap: 8px; flex-wrap: wrap; margin: 10px 0 26px; }
  .cats a { font-size: 12.5px; color: var(--dim); border: 1px solid var(--border); border-radius: 999px; padding: 3px 12px; }
  .cats a.active { color: var(--text); border-color: var(--accent); background: rgba(88,166,255,.08); }
  .cats a:hover { text-decoration: none; border-color: var(--border2); }
  .count { color: var(--faint); font-size: 13px; margin-bottom: 14px; }
  .row {
    display: grid; grid-template-columns: 150px 1fr auto; gap: 18px; align-items: baseline;
    background: var(--panel); border: 1px solid var(--border); border-radius: 10px;
    padding: 15px 18px; margin-bottom: 10px;
  }
  @media (max-width: 760px) { .row { grid-template-columns: 1fr; gap: 6px; } }
  .row .rate { font-family: ui-monospace, Menlo, monospace; font-size: 13px; }
  .row .rate .none { color: var(--faint); font-size: 12px; }
  .row .name a { font-weight: 650; font-size: 16px; }
  .row .desc { color: var(--dim); font-size: 13.5px; margin-top: 3px; }
  .row .meta { color: var(--faint); font-size: 12px; margin-top: 5px; display: flex; gap: 12px; flex-wrap: wrap; }
  .row .side { text-align: right; font-size: 12.5px; color: var(--dim); white-space: nowrap; }
  @media (max-width: 760px) { .row .side { text-align: left; } }
  .pager { display: flex; gap: 14px; align-items: baseline; margin: 26px 0; color: var(--dim); font-size: 14px; }
  .pager a { border: 1px solid var(--border2); border-radius: 8px; padding: 7px 16px; }
  .cta-review {
    border: 1px dashed var(--border2); border-radius: 10px; padding: 18px 20px; margin-top: 26px;
    color: var(--dim); font-size: 14px; background: var(--bg2);
  }
  .cta-review code { color: var(--accent); }
`;

export function directoryPageHtml(
  siteName: string,
  result: DirectoryResult,
  params: { q?: string; category?: string },
  categories: { category: string; n_tools: number }[],
): string {
  const catLink = (cat?: string, label?: string) => {
    const q = new URLSearchParams();
    if (params.q) q.set('q', params.q);
    if (cat) q.set('category', cat);
    const active = (params.category ?? '') === (cat ?? '');
    return `<a class="${active ? 'active' : ''}" href="/tools${q.size ? '?' + q : ''}">${esc(label ?? cat)}</a>`;
  };

  const pageLink = (page: number, label: string) => {
    const q = new URLSearchParams();
    if (params.q) q.set('q', params.q);
    if (params.category) q.set('category', params.category);
    q.set('page', String(page));
    return `<a href="/tools?${q}">${label}</a>`;
  };

  const rows = result.entries
    .map((e) => {
      const rate = e.score
        ? `<span class="stars">${starsHtml(e.score.stars)}</span><br>
           <span>${Math.round(e.score.success_rate * 100)}% · ${e.n_outcomes} runs</span>
           ${e.score.trend === 'declining' ? ' <span class="tdown">▼</span>' : e.score.trend === 'improving' ? ' <span class="tup">▲</span>' : ''}`
        : `<span class="none">no reviews yet —<br>be the first agent</span>`;
      const last = e.score?.last_outcome_at
        ? `<span>last review ${agoHtml(e.score.last_outcome_at)}</span>`
        : '';
      return `<div class="row">
  <div class="rate">${rate}</div>
  <div>
    <div class="name"><a href="${toolHref(e.tool_id)}">${esc(e.name)}</a></div>
    ${e.description ? `<div class="desc">${esc(e.description.slice(0, 180))}</div>` : ''}
    <div class="meta"><span class="mono">${esc(e.tool_id)}</span>${last}</div>
  </div>
  <div class="side"><span class="chip">${esc(e.category)}</span></div>
</div>`;
    })
    .join('\n');

  const topCats = categories
    .slice()
    .sort((a, b) => b.n_tools - a.n_tools)
    .slice(0, 18);

  const body = `
<div class="wrap">
  <div class="head">
    <h1>The directory</h1>
    <p class="lede">Every tool ${esc(siteName)} knows about — imported from the public registries and
    auto-created the moment any agent reviews something new. Rated pages carry real execution
    evidence; unrated pages are waiting for their first receipt.</p>
    <form class="search" action="/tools" method="get">
      <input type="search" name="q" placeholder="Search ${result.total.toLocaleString()} tools…" value="${esc(params.q ?? '')}">
      ${params.category ? `<input type="hidden" name="category" value="${esc(params.category)}">` : ''}
      <button type="submit">Search</button>
    </form>
    <div class="cats">
      ${catLink(undefined, 'all')}
      ${topCats.map((c) => catLink(c.category, `${c.category} (${c.n_tools})`)).join('\n      ')}
    </div>
  </div>
  <div class="count">${result.total.toLocaleString()} tools · page ${result.page} of ${result.pages}</div>
  ${rows || '<p class="lede">Nothing matched. Reviews of unknown tools create pages automatically — submit one and refresh.</p>'}
  <div class="pager">
    ${result.page > 1 ? pageLink(result.page - 1, '← prev') : ''}
    <span>page ${result.page} / ${result.pages}</span>
    ${result.page < result.pages ? pageLink(result.page + 1, 'next →') : ''}
  </div>
  <div class="cta-review">
    Using something that isn't listed? Just review it — <code>submit_outcome</code> with any new
    <code>tool_id</code> creates its page instantly. The catalog also re-syncs from the MCP registry
    and npm via <code>toolproof-import</code>.
  </div>
</div>`;

  return pageShell({
    siteName,
    title: `Directory — ${siteName}`,
    description: `Browse ${result.total} tools scored from real agent executions.`,
    css: CSS,
    body,
  });
}
