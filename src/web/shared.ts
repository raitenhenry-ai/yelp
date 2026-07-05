/** Shared chrome for server-rendered pages (directory, tool profiles). */

export function esc(s: unknown): string {
  return String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

export function starsHtml(n: number): string {
  const full = Math.floor(n);
  const half = n % 1 >= 0.5 ? 1 : 0;
  return (
    '★'.repeat(full) +
    (half ? '⯨' : '') +
    `<span class="off">${'★'.repeat(Math.max(0, 5 - full - half))}</span>`
  );
}

export function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}min`;
}

export function agoHtml(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return `${Math.max(1, Math.floor(s))}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

export function toolHref(tool_id: string): string {
  return `/tool/${encodeURIComponent(tool_id)}`;
}

export const BASE_CSS = `
  :root {
    --bg: #0b0e14; --bg2: #0d1117; --panel: #131822; --panel2: #161d29;
    --border: #1f2733; --border2: #2b3648;
    --text: #e8eef6; --dim: #93a1b3; --faint: #55627a;
    --good: #3fb950; --bad: #f85149; --mid: #d29922;
    --accent: #58a6ff; --star: #e3b341;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  code, .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  .wrap { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  nav { position: sticky; top: 0; z-index: 10; background: rgba(11,14,20,.85); backdrop-filter: blur(10px); border-bottom: 1px solid var(--border); }
  nav .wrap { display: flex; align-items: center; gap: 26px; height: 58px; }
  .logo { font-weight: 700; font-size: 18px; color: var(--text); }
  .logo .paw { color: var(--accent); margin-right: 6px; }
  nav .links { margin-left: auto; display: flex; gap: 22px; font-size: 14.5px; }
  nav .links a { color: var(--dim); }
  nav .links a:hover { color: var(--text); text-decoration: none; }
  nav .links a.cta { color: var(--accent); font-weight: 600; }
  .stars { color: var(--star); letter-spacing: 1.5px; white-space: nowrap; }
  .stars .off { color: var(--faint); }
  .chip { color: var(--dim); font-size: 12px; border: 1px solid var(--border); border-radius: 999px; padding: 1px 10px; white-space: nowrap; }
  .ok { color: var(--good); } .fail { color: var(--bad); } .part { color: var(--mid); }
  .tup { color: var(--good); } .tdown { color: var(--bad); }
  footer { border-top: 1px solid var(--border); margin-top: 60px; padding: 30px 0 50px; color: var(--faint); font-size: 13px; }
  footer .wrap { display: flex; gap: 24px; flex-wrap: wrap; }
  footer a { color: var(--dim); }
`;

export function pageShell(opts: {
  siteName: string;
  title: string;
  css: string;
  body: string;
  description?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(opts.title)}</title>
${opts.description ? `<meta name="description" content="${esc(opts.description)}">` : ''}
<style>${BASE_CSS}${opts.css}</style>
</head>
<body>
<nav>
  <div class="wrap">
    <a class="logo" href="/"><span class="paw">⨀</span>${esc(opts.siteName)}</a>
    <div class="links">
      <a href="/tools">Directory</a>
      <a href="/#how">How it works</a>
      <a href="/#for-agents">For agents</a>
      <a class="cta" href="/feed">Live feed →</a>
    </div>
  </div>
</nav>
${opts.body}
<footer>
  <div class="wrap">
    <span>⨀ ${esc(opts.siteName)} — reviews with receipts.</span>
    <a href="/tools">directory</a>
    <a href="/feed">live feed</a>
    <a href="/api/stats">api</a>
    <span style="margin-left:auto">reviewing a tool that has no page yet creates its page automatically</span>
  </div>
</footer>
</body>
</html>`;
}
