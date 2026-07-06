/**
 * Deriving a legit, human display name for an imported tool.
 *
 * Registry entries are inconsistent: some have a proper `title`, many have only
 * a reverse-DNS id ("ai.gomarble/mcp-api") and a description that actually
 * contains the real brand ("GoMarble MCP API Server"). We want "GoMarble", not
 * the raw id and not a generic phrase. Strategy, in order:
 *   1. the leading proper-noun run of the description (recovers real casing),
 *   2. a real title (minus a trailing "MCP"/"Server"/"API" boilerplate),
 *   3. the brand segment of the reverse-DNS namespace, title-cased.
 */

// Reverse-DNS segments that are hosts/TLDs, not the brand.
const HOST_SEGMENTS = new Set(['github', 'gitlab', 'gitee', 'bitbucket', 'codeberg', 'sr']);
// Words that are boilerplate, never the product name on their own.
const GENERIC = new Set([
  'mcp', 'api', 'server', 'sdk', 'service', 'tool', 'tools', 'client', 'app',
  'the', 'a', 'an', 'this', 'that', 'for', 'to', 'and', 'with', 'of', 'your',
  'official', 'unofficial', 'simple', 'model', 'context', 'protocol',
]);

/** The brand segment of a reverse-DNS namespace: "ai.gomarble" → "gomarble",
 * "io.github.microsoft" → "microsoft". */
export function brandFromNamespace(registryName: string): string {
  const ns = registryName.split('/')[0] ?? registryName;
  const parts = ns.split('.').filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? ns;
  let idx = 1; // skip the leading TLD-ish segment (ai, io, com, ac, agency…)
  if (HOST_SEGMENTS.has(parts[1])) idx = 2; // io.github.<owner>
  return parts[idx] ?? parts[parts.length - 1];
}

const NAME_TOKEN = /^[A-Z0-9][A-Za-z0-9.+&'-]*$/;

/** Take the leading run of capitalized, non-generic words from a description —
 * usually the product name ("GoMarble MCP API Server" → ["GoMarble"]). */
function leadingProperName(description: string): string[] {
  const tokens = description.trim().split(/\s+/);
  const out: string[] = [];
  for (const raw of tokens) {
    const t = raw.replace(/[.,:;–—-]+$/, '');
    if (!NAME_TOKEN.test(t) || GENERIC.has(t.toLowerCase())) break;
    out.push(t);
    if (out.length >= 4) break;
  }
  return out;
}

function titleCase(s: string): string {
  return s
    .split(/[-_.\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Strip trailing boilerplate ("Acme MCP Server" → "Acme"), but never to empty. */
function trimBoilerplate(name: string): string {
  const words = name.trim().split(/\s+/);
  while (words.length > 1 && GENERIC.has(words[words.length - 1].toLowerCase())) words.pop();
  return words.join(' ');
}

/** The short name after the '/', cleaned of boilerplate ("weather-bot" →
 * "Weather Bot", "playwright-mcp" → "Playwright"). May be empty. */
function cleanShort(registryName: string): string {
  return titleCase(
    (registryName.split('/')[1] ?? '')
      .split(/[-_.]+/)
      .filter((w) => w && !GENERIC.has(w.toLowerCase()))
      .join(' '),
  );
}

/**
 * Best display name from a registry entry.
 * `registryName` is the reverse-DNS id (no "mcp:" prefix).
 *
 * Only reliable signals are used — a description lead that MATCHES the
 * namespace brand (recovers real casing, e.g. "GoMarble"), a real title, or
 * the structural name. A description that merely starts with a capital word
 * ("Remote…", "Get…") is ignored, since that's a sentence, not a brand.
 */
export function prettyName(
  registryName: string,
  title: string | undefined,
  description: string,
): string {
  const ns = registryName.split('/')[0] ?? registryName;
  const parts = ns.split('.').filter(Boolean);
  const isCodeHost = parts.length > 2 && HOST_SEGMENTS.has(parts[1]);
  const brand = brandFromNamespace(registryName);

  // 1. Description lead whose first word matches the brand → real casing.
  const lead = leadingProperName(description || '');
  if (lead.length && lead[0].toLowerCase() === brand.toLowerCase()) return lead.join(' ');

  // 2. A real, human title (minus "…MCP Server" boilerplate).
  if (title && title.trim() && title !== registryName && !title.includes('/')) {
    const t = trimBoilerplate(title.trim());
    if (t.length >= 2) return t;
  }

  // 3. Structural: a GitHub/GitLab repo's real name is the repo (shortname);
  //    a real-domain namespace's real name is the brand segment.
  const short = cleanShort(registryName);
  const brandTC = titleCase(brand);
  const primary = isCodeHost ? short : brandTC;
  const secondary = isCodeHost ? brandTC : short;
  if (primary.length >= 2) return primary;
  if (secondary.length >= 2) return secondary;
  return brandTC || registryName;
}
