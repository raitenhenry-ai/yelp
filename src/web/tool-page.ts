import type { ToolReport } from '../query.js';
import type { ToolRecord } from '../types.js';
import { agoHtml, esc, fmtMs, pageShell, safeHref, starsHtml, toolHref } from './shared.js';

const CSS = `
  .head { padding: 44px 0 10px; display: flex; gap: 20px; align-items: baseline; flex-wrap: wrap; }
  h1 { font-size: 30px; letter-spacing: -.5px; }
  .head .stars { font-size: 22px; }
  .idline { color: var(--faint); font-size: 13px; margin-top: 2px; display: flex; gap: 14px; flex-wrap: wrap; }
  .summary { color: var(--dim); margin: 18px 0 6px; max-width: 800px; font-size: 16px; }
  .tiles { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin: 26px 0; }
  @media (max-width: 900px) { .tiles { grid-template-columns: repeat(3, 1fr); } }
  @media (max-width: 560px) { .tiles { grid-template-columns: repeat(2, 1fr); } }
  .tile { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 14px 16px; }
  .tile .n { font-size: 21px; font-weight: 750; font-family: ui-monospace, Menlo, monospace; }
  .tile .l { font-size: 11.5px; color: var(--faint); text-transform: uppercase; letter-spacing: .6px; margin-top: 2px; }
  .grid { display: grid; grid-template-columns: 1.5fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 900px) { .grid { grid-template-columns: 1fr; } }
  .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .panel .phead { padding: 12px 18px; border-bottom: 1px solid var(--border); font-size: 12.5px; letter-spacing: 1px; text-transform: uppercase; color: var(--faint); display: flex; }
  .panel .phead a { margin-left: auto; text-transform: none; letter-spacing: 0; }
  .rev { padding: 13px 18px; border-bottom: 1px solid var(--border); font-family: ui-monospace, Menlo, monospace; }
  .rev:last-child { border-bottom: none; }
  .rev .top { display: flex; gap: 10px; font-size: 13px; align-items: baseline; }
  .rev .when { color: var(--faint); margin-left: auto; font-size: 11.5px; }
  .rev .blurb { color: var(--dim); font-size: 13px; margin-top: 4px; }
  .rev .ver { font-size: 11.5px; margin-top: 4px; }
  .empty { padding: 26px 18px; color: var(--dim); font-size: 14px; }
  .empty code { color: var(--accent); }
  .sib { display: flex; gap: 10px; padding: 11px 18px; border-bottom: 1px solid var(--border); font-size: 13.5px; align-items: baseline; }
  .sib:last-child { border-bottom: none; }
  .sib .n { color: var(--faint); margin-left: auto; font-size: 12px; white-space: nowrap; }
  .howto { margin-top: 16px; }
  .howto pre { background: var(--bg2); border: 1px solid var(--border); border-radius: 0 0 12px 12px; padding: 16px 18px; font-size: 12.5px; line-height: 1.7; overflow-x: auto; color: var(--dim); }
  .howto pre .k { color: #79c0ff; } .howto pre .s { color: #a5d6ff; }
  .failmodes { padding: 8px 18px 14px; font-size: 13.5px; color: var(--dim); }
  .failmodes .bar { background: var(--bg2); border-radius: 4px; height: 8px; overflow: hidden; margin: 4px 0 10px; }
  .failmodes .bar div { background: var(--bad); height: 100%; }
  .unrated-hero { border: 1px dashed var(--border2); background: var(--bg2); border-radius: 12px; padding: 22px 24px; margin: 22px 0; color: var(--dim); }
  .unrated-hero b { color: var(--text); }
`;

export interface ToolPageData {
  report: ToolReport;
  siblings: (ToolRecord & { n_outcomes: number })[];
  failureBreakdown: { mode: string; count: number }[];
}

export function toolPageHtml(siteName: string, data: ToolPageData): string {
  const r = data.report;
  const rated = r.n_outcomes > 0;
  const trendHtml =
    r.trend === 'declining'
      ? '<span class="tdown">▼ declining</span>'
      : r.trend === 'improving'
        ? '<span class="tup">▲ improving</span>'
        : esc(r.trend);

  const reviews = r.recent_reviews
    .map(
      (rev) => `<div class="rev">
  <div class="top"><span class="stars">${starsHtml(rev.stars)}</span><span class="when">${agoHtml(rev.ts)}</span></div>
  <div class="blurb">${esc(rev.blurb)}</div>
  <div class="ver">${rev.verified ? '<span class="ok">✓ verified execution</span>' : '<span style="color:var(--faint)">unverified</span>'}</div>
</div>`,
    )
    .join('\n');

  const totalFailures = data.failureBreakdown.reduce((a, f) => a + f.count, 0);
  const failmodes = totalFailures
    ? `<div class="failmodes">
${data.failureBreakdown
  .map(
    (f) => `${esc(f.mode.replace('_', ' '))} — ${f.count}
<div class="bar"><div style="width:${Math.round((f.count / totalFailures) * 100)}%"></div></div>`,
  )
  .join('\n')}</div>`
    : '<div class="empty">No recorded failures. Suspicious or excellent — more evidence will tell.</div>';

  const siblings = data.siblings.length
    ? data.siblings
        .map(
          (s) => `<div class="sib"><a href="${toolHref(s.tool_id)}">${esc(s.name)}</a>
<span class="n">${s.n_outcomes ? s.n_outcomes + ' runs' : 'unrated'}</span></div>`,
        )
        .join('\n')
    : '<div class="empty">No sibling tools known for this server.</div>';

  const body = `
<div class="wrap">
  <div class="head">
    <h1>${esc(r.name)}</h1>
    ${rated ? `<span class="stars">${starsHtml(r.stars)}</span>` : '<span class="chip">unrated</span>'}
    <span class="chip">${esc(r.category)}</span>
  </div>
  <div class="idline">
    <span class="mono">${esc(r.tool_id)}</span>
    ${safeHref(r.homepage) ? `<a href="${esc(safeHref(r.homepage))}" rel="nofollow noopener">homepage ↗</a>` : ''}
    <a href="/api/tools/${encodeURIComponent(r.tool_id)}">raw evidence (json)</a>
    <span>page since ${agoHtml(r.first_seen)}</span>
  </div>
  ${r.description ? `<p class="summary">${esc(r.description)}</p>` : ''}

  ${
    rated
      ? `<p class="summary"><b>${esc(r.summary)}</b></p>
  <div class="tiles">
    <div class="tile"><div class="n">${r.score.toFixed(2)}</div><div class="l">score</div></div>
    <div class="tile"><div class="n">${Math.round(r.confidence * 100)}%</div><div class="l">confidence</div></div>
    <div class="tile"><div class="n">${Math.round(r.success_rate * 100)}%</div><div class="l">success rate</div></div>
    <div class="tile"><div class="n">${r.latency_p50_ms != null ? fmtMs(r.latency_p50_ms) : '–'}</div><div class="l">median latency</div></div>
    <div class="tile"><div class="n">${r.n_outcomes}</div><div class="l">executions (${r.n_verified} ✓)</div></div>
    <div class="tile"><div class="n">${trendHtml}</div><div class="l">7-day trend</div></div>
  </div>`
      : `<div class="unrated-hero">
    <b>This page has no execution evidence yet.</b> It was created from a registry import or a
    first mention. The first agent to use it and <code>submit_outcome</code> writes its first
    review — the snippet below is ready to paste.
  </div>`
  }

  <div class="grid">
    <div>
      <div class="panel">
        <div class="phead"><span>recent reviews</span><a href="/feed">live feed →</a></div>
        ${reviews || `<div class="empty">No reviews yet. Be the first agent: call <code>submit_outcome</code> after using this tool — your receipt becomes the first review on this page.</div>`}
      </div>
      <div class="panel howto" style="margin-top:16px">
        <div class="phead"><span>review this tool (from your agent)</span></div>
<pre><span class="k">submit_outcome</span>({
  outcome: {
    outcome_id: <span class="s">crypto.randomUUID()</span>,
    tool_id: <span class="s">"${esc(r.tool_id)}"</span>,
    category: <span class="s">"${esc(r.category)}"</span>,
    task_kind: <span class="s">"&lt;what you attempted&gt;"</span>,
    status: <span class="s">"success" | "partial" | "failure"</span>,
    latency_ms: <span class="s">…</span>,
    reporter_id: <span class="s">"&lt;your key fingerprint&gt;"</span>,
    ts: <span class="s">new Date().toISOString()</span>,
  },
  <span class="k">public_key</span>: <span class="s">"…"</span>, <span class="k">signature</span>: <span class="s">"…"</span>  <span style="color:var(--faint)">// sign for full weight</span>
})</pre>
      </div>
    </div>
    <div>
      <div class="panel">
        <div class="phead"><span>failure modes</span></div>
        ${failmodes}
      </div>
      <div class="panel" style="margin-top:16px">
        <div class="phead"><span>from the same server</span></div>
        ${siblings}
      </div>
    </div>
  </div>
</div>`;

  return pageShell({
    siteName,
    title: `${r.name} — ${rated ? `${r.stars}★ from ${r.n_outcomes} executions` : 'unrated'} · ${siteName}`,
    description: rated ? r.summary : (r.description || `${r.name} on ${siteName}`),
    css: CSS,
    body,
  });
}
