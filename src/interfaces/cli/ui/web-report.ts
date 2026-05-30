import fs from 'node:fs/promises';
import path from 'node:path';

import { loadCatalogItems, loadQuarantine, loadWhitelist } from '../../../catalog/repository.js';
import { loadItemInsights, loadSecurityPolicy } from '../../../config/runtime.js';
import type { CatalogKind, CatalogItem, ItemInsight, RiskAssessment, SecurityPolicy } from '../../../lib/validation/contracts.js';
import { buildAssessment } from '../../../security/assessment.js';

interface WebReportOptions {
  outputPath: string;
  kinds?: CatalogKind[];
  limit: number;
}

export async function writeWebReport(options: WebReportOptions): Promise<{
  outputPath: string;
  items: number;
}> {
  const [items, whitelist, quarantine, policy, insights] = await Promise.all([
    loadCatalogItems(),
    loadWhitelist(),
    loadQuarantine(),
    loadSecurityPolicy(),
    loadItemInsights()
  ]);
  const allFiltered = filterByKinds(items, options.kinds);
  const filtered = allFiltered.slice(0, options.limit);
  const quarantineIds = new Set(quarantine.map((entry) => entry.id));
  const rows = filtered.map((item) => {
    const assessment = buildAssessment(item, policy);
    const blockedByPolicy = assessment.riskTier === 'high' || assessment.riskTier === 'critical';
    const blocked = blockedByPolicy || quarantineIds.has(item.id);
    return { item, assessment, blocked, approved: whitelist.has(item.id), insight: insights.get(item.id) };
  });

  const html = renderHtml(
    rows,
    allFiltered,
    {
      totalItems: allFiltered.length,
      shownItems: filtered.length,
      whitelist: whitelist.size,
      quarantined: quarantine.length
    },
    policy
  );

  const resolvedOutput = path.resolve(options.outputPath);
  await fs.mkdir(path.dirname(resolvedOutput), { recursive: true });
  await fs.writeFile(resolvedOutput, html, 'utf8');
  return { outputPath: resolvedOutput, items: filtered.length };
}

function filterByKinds(items: CatalogItem[], kinds?: CatalogKind[]): CatalogItem[] {
  if (!kinds || kinds.length === 0) {
    return items;
  }

  const set = new Set(kinds);
  return items.filter((item) => set.has(item.kind));
}

function renderHtml(
  rows: Array<{
    item: CatalogItem;
    assessment: RiskAssessment;
    blocked: boolean;
    approved: boolean;
    insight?: ItemInsight;
  }>,
  allItems: CatalogItem[],
  stats: { totalItems: number; shownItems: number; whitelist: number; quarantined: number },
  policy: SecurityPolicy
): string {
  const kindCounts = countByKind(allItems);
  const riskScale = escapeHtml(formatRiskScale(policy));
  const cardsJson = rows.map((entry) => renderDetailCard(entry)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PlugScout Web Report</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #050916;
      --panel: #0d1626;
      --panel2: #111e32;
      --line: #1e3050;
      --text: #e8f0fb;
      --muted: #9ab0cc;
      --ok: #34d058;
      --warn: #f59e0b;
      --bad: #f06060;
      --accent: #60a5fa;
      --accent2: #818cf8;
      --blocked-border: #7f1d1d;
    }
    * { box-sizing: border-box; }
    .sr-only { position:absolute; width:1px; height:1px; padding:0; margin:-1px; overflow:hidden; clip:rect(0,0,0,0); white-space:nowrap; border:0; }
    body {
      margin: 0;
      font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: var(--text);
      background: radial-gradient(ellipse at 50% 0%, #0d1f40 0%, var(--bg) 55%);
      padding: 28px 24px;
    }
    a:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible {
      outline: 2px solid var(--accent);
      outline-offset: 2px;
    }
    .wrap { max-width: 1500px; margin: 0 auto; }
    h1 { margin: 0 0 6px; font-size: 30px; letter-spacing: -0.3px; }
    .sub { color: var(--muted); margin: 0 0 20px; font-size: 14px; line-height: 1.6; }
    /* Stat cards */
    .stat-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
      gap: 10px;
      margin-bottom: 16px;
    }
    .stat-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 14px;
      cursor: default;
      transition: border-color 0.12s, background 0.12s;
    }
    .stat-card.clickable { cursor: pointer; }
    .stat-card.clickable:hover { border-color: var(--accent); background: var(--panel2); }
    .stat-card.clickable:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    .stat-card.active { border-color: var(--accent); background: var(--panel2); }
    .k { color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; }
    .v { font-size: 24px; font-weight: 700; margin-top: 3px; color: var(--text); }
    /* Legend */
    .legend {
      margin-bottom: 16px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 16px;
      font-size: 13px;
      color: var(--muted);
      line-height: 1.7;
    }
    .legend strong { color: var(--text); }
    /* Filter bar */
    .filter-bar {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 10px;
      padding: 12px 16px;
      margin-bottom: 16px;
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
    }
    .filter-bar input, .filter-bar select {
      background: #060e1c;
      border: 1px solid #253a58;
      border-radius: 7px;
      color: var(--text);
      padding: 7px 10px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.12s;
    }
    .filter-bar input { flex: 1; min-width: 180px; }
    .filter-bar input::placeholder { color: var(--muted); }
    .filter-bar select:focus, .filter-bar input:focus { border-color: var(--accent); }
    .btn-clear {
      background: none;
      border: 1px solid #253a58;
      border-radius: 7px;
      color: var(--muted);
      padding: 7px 12px;
      font-size: 13px;
      cursor: pointer;
      transition: border-color 0.12s, color 0.12s;
    }
    .btn-clear:hover { border-color: var(--accent); color: var(--text); }
    #result-count { color: var(--muted); font-size: 13px; margin-left: auto; white-space: nowrap; }
    /* Grid */
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(370px, 1fr));
      gap: 10px;
    }
    /* Cards */
    .detail-card {
      border: 1px solid #1e3050;
      border-radius: 10px;
      background: #080f1e;
      overflow: hidden;
      transition: border-color 0.12s;
    }
    .detail-card:hover { border-color: #3a5a8a; }
    .detail-card.is-blocked {
      border-left: 3px solid var(--blocked-border);
    }
    .detail-card.is-blocked:hover { border-color: #a33; border-left-color: var(--bad); }
    /* Card header is a button for accessibility */
    .card-header {
      display: block;
      width: 100%;
      text-align: left;
      background: none;
      border: none;
      padding: 14px;
      cursor: pointer;
      color: var(--text);
      font-family: inherit;
      font-size: inherit;
      line-height: inherit;
    }
    .card-header:hover { background: rgba(255,255,255,0.025); }
    .card-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .title { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.3; }
    .meta { color: var(--muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin-bottom: 8px; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 5px; margin-bottom: 7px; }
    .pill {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid #2d4868;
      padding: 2px 9px;
      font-size: 12px;
      color: var(--text);
      white-space: nowrap;
    }
    .ok { color: var(--ok); border-color: #14532d; }
    .warn { color: var(--warn); border-color: #78350f; }
    .bad { color: var(--bad); border-color: #7f1d1d; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .chip {
      border: 1px solid #2a4060;
      border-radius: 999px;
      padding: 2px 8px;
      color: #bdd2f0;
      font-size: 12px;
    }
    .expand-hint {
      font-size: 11px;
      color: #7a9ec4;
      margin-top: 8px;
      text-align: right;
    }
    .detail-card.expanded .expand-hint { display: none; }
    /* Expanded body */
    .card-body {
      display: none;
      padding: 0 14px 14px;
      border-top: 1px solid #172538;
    }
    .detail-card.expanded .card-body { display: block; }
    .line { margin-top: 9px; color: var(--text); font-size: 13.5px; line-height: 1.5; }
    .line .label { color: var(--muted); }
    .link { color: #93c5fd; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    /* Install block */
    .install-block {
      margin-top: 10px;
      border: 1px solid #1e3050;
      border-radius: 8px;
      overflow: hidden;
    }
    .install-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 10px;
      background: #0a1626;
      border-bottom: 1px solid #1e3050;
    }
    .install-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.06em; }
    .copy-btn {
      background: #1a3050;
      border: 1px solid #2d4868;
      border-radius: 5px;
      color: var(--accent);
      padding: 3px 10px;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.12s;
    }
    .copy-btn:hover { background: #243d60; }
    .copy-btn.copied { color: var(--ok); border-color: #14532d; }
    pre.install-pre {
      margin: 0;
      padding: 9px 12px;
      background: #050c1a;
      overflow-x: auto;
      color: #c9deff;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .plugscout-install {
      margin-top: 8px;
      padding: 8px 12px;
      background: #060e1c;
      border: 1px solid #1e3050;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .plugscout-install code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      color: var(--accent);
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>PlugScout Web Report</h1>
    <p class="sub">
      Claude plugins &nbsp;·&nbsp; Claude connectors &nbsp;·&nbsp; Copilot extensions &nbsp;·&nbsp;
      Cursor extensions &nbsp;·&nbsp; Gemini extensions &nbsp;·&nbsp; Skills &nbsp;·&nbsp; MCP servers
    </p>
    ${stats.shownItems < stats.totalItems ? `<p class="sub">Showing ${stats.shownItems.toLocaleString()} of ${stats.totalItems.toLocaleString()} catalog items &nbsp;·&nbsp; stat card counts reflect full catalog &nbsp;·&nbsp; rerun with <code>--limit ${stats.totalItems}</code> to include all</p>` : ''}

    <div class="stat-cards">
      <div class="stat-card"><div class="k">Total catalog</div><div class="v">${stats.totalItems.toLocaleString()}</div></div>
      <div class="stat-card clickable" role="button" tabindex="0" onclick="setKindFilter('claude-plugin')" onkeydown="if(event.key==='Enter'||event.key===' ')setKindFilter('claude-plugin')"><div class="k">Claude Plugins</div><div class="v">${kindCounts['claude-plugin'].toLocaleString()}</div></div>
      <div class="stat-card clickable" role="button" tabindex="0" onclick="setKindFilter('claude-connector')" onkeydown="if(event.key==='Enter'||event.key===' ')setKindFilter('claude-connector')"><div class="k">Claude Connectors</div><div class="v">${kindCounts['claude-connector'].toLocaleString()}</div></div>
      <div class="stat-card clickable" role="button" tabindex="0" onclick="setKindFilter('copilot-extension')" onkeydown="if(event.key==='Enter'||event.key===' ')setKindFilter('copilot-extension')"><div class="k">Copilot Extensions</div><div class="v">${kindCounts['copilot-extension'].toLocaleString()}</div></div>
      <div class="stat-card clickable" role="button" tabindex="0" onclick="setKindFilter('cursor-extension')" onkeydown="if(event.key==='Enter'||event.key===' ')setKindFilter('cursor-extension')"><div class="k">Cursor Extensions</div><div class="v">${kindCounts['cursor-extension'].toLocaleString()}</div></div>
      <div class="stat-card clickable" role="button" tabindex="0" onclick="setKindFilter('gemini-extension')" onkeydown="if(event.key==='Enter'||event.key===' ')setKindFilter('gemini-extension')"><div class="k">Gemini Extensions</div><div class="v">${kindCounts['gemini-extension'].toLocaleString()}</div></div>
      <div class="stat-card clickable" role="button" tabindex="0" onclick="setKindFilter('skill')" onkeydown="if(event.key==='Enter'||event.key===' ')setKindFilter('skill')"><div class="k">Skills</div><div class="v">${kindCounts.skill.toLocaleString()}</div></div>
      <div class="stat-card clickable" role="button" tabindex="0" onclick="setKindFilter('mcp')" onkeydown="if(event.key==='Enter'||event.key===' ')setKindFilter('mcp')"><div class="k">MCP Servers</div><div class="v">${kindCounts.mcp.toLocaleString()}</div></div>
      <div class="stat-card"><div class="k">Whitelist / Quarantine</div><div class="v">${stats.whitelist} / ${stats.quarantined}</div></div>
    </div>

    <details class="legend">
      <summary><strong>Score &amp; risk legend</strong> <span style="font-weight:normal;color:var(--muted)">(click to expand)</span></summary>
      <div style="margin-top:8px">
        <strong>Trust</strong> 0–100 — higher = more trustworthy (provenance, maintenance, adoption)<br>
        <strong>Risk</strong> 0–100 — lower = safer &nbsp;·&nbsp; ${riskScale}<br>
        <span style="color:var(--bad)">■</span> <strong>Blocked</strong> = high/critical risk or quarantined &nbsp;·&nbsp; left red border on card<br>
        <span style="color:var(--ok)">■</span> <strong>Allowed</strong> = passes policy &nbsp;·&nbsp; <span style="color:var(--warn)">■</span> <strong>Approved</strong> = manually whitelisted
      </div>
    </details>

    <div class="filter-bar" role="search">
      <label class="sr-only" for="search">Search catalog</label>
      <input id="search" type="search" placeholder="Search by name, ID, or capability…" oninput="applyFilters()" autocomplete="off" />
      <label class="sr-only" for="kind-filter">Filter by kind</label>
      <select id="kind-filter" onchange="applyFilters()">
        <option value="">All kinds</option>
        <option value="claude-plugin">Claude plugin</option>
        <option value="claude-connector">Claude connector</option>
        <option value="copilot-extension">Copilot extension</option>
        <option value="cursor-extension">Cursor extension</option>
        <option value="gemini-extension">Gemini extension</option>
        <option value="skill">Skill</option>
        <option value="mcp">MCP server</option>
      </select>
      <label class="sr-only" for="risk-filter">Filter by risk tier</label>
      <select id="risk-filter" onchange="applyFilters()">
        <option value="">All risk tiers</option>
        <option value="low">Low risk</option>
        <option value="medium">Medium risk</option>
        <option value="high">High risk</option>
        <option value="critical">Critical risk</option>
      </select>
      <label class="sr-only" for="status-filter">Filter by status</label>
      <select id="status-filter" onchange="applyFilters()">
        <option value="">All statuses</option>
        <option value="allowed">Allowed</option>
        <option value="approved">Whitelisted</option>
        <option value="blocked">Blocked</option>
      </select>
      <label class="sr-only" for="sort-by">Sort by</label>
      <select id="sort-by" onchange="applyFilters()">
        <option value="name">Name A–Z</option>
        <option value="trust-desc">Trust ↓ (most trusted first)</option>
        <option value="risk-asc">Risk ↑ (safest first)</option>
        <option value="risk-desc">Risk ↓ (riskiest first)</option>
      </select>
      <button class="btn-clear" onclick="clearFilters()" type="button">Clear filters</button>
      <span id="result-count" aria-live="polite" aria-atomic="true"></span>
    </div>

    <div class="detail-grid" id="card-grid" role="list">
      ${cardsJson}
    </div>
  </div>

  <script>
    function toggleCard(btn) {
      const card = btn.closest('.detail-card');
      const expanded = card.classList.toggle('expanded');
      btn.setAttribute('aria-expanded', String(expanded));
    }

    function setKindFilter(kind) {
      document.getElementById('kind-filter').value = kind;
      // Toggle: clicking active kind card resets to all
      const cards = document.querySelectorAll('.stat-card.clickable');
      cards.forEach(c => {
        const onclick = c.getAttribute('onclick') || '';
        c.classList.toggle('active', onclick.includes("'" + kind + "'"));
      });
      applyFilters();
    }

    function clearFilters() {
      document.getElementById('search').value = '';
      document.getElementById('kind-filter').value = '';
      document.getElementById('risk-filter').value = '';
      document.getElementById('status-filter').value = '';
      document.getElementById('sort-by').value = 'name';
      document.querySelectorAll('.stat-card.clickable').forEach(c => c.classList.remove('active'));
      applyFilters();
    }

    function applyFilters() {
      const search = document.getElementById('search').value.toLowerCase().trim();
      const kind = document.getElementById('kind-filter').value;
      const risk = document.getElementById('risk-filter').value;
      const status = document.getElementById('status-filter').value;
      const sort = document.getElementById('sort-by').value;

      const grid = document.getElementById('card-grid');
      const cards = Array.from(grid.querySelectorAll('.detail-card'));

      let visible = 0;
      cards.forEach(card => {
        const matchSearch = !search || card.dataset.search.includes(search);
        const matchKind = !kind || card.dataset.kind === kind;
        const matchRisk = !risk || card.dataset.risk === risk;
        const matchStatus = !status || card.dataset.status === status;
        const show = matchSearch && matchKind && matchRisk && matchStatus;
        card.classList.toggle('hidden', !show);
        if (show) visible++;
      });

      document.getElementById('result-count').textContent = visible.toLocaleString() + ' of ' + cards.length.toLocaleString() + ' shown';

      const shown = cards.filter(c => !c.classList.contains('hidden'));
      shown.sort((a, b) => {
        if (sort === 'trust-desc') return Number(b.dataset.trust) - Number(a.dataset.trust);
        if (sort === 'risk-asc') return Number(a.dataset.riskscore) - Number(b.dataset.riskscore);
        if (sort === 'risk-desc') return Number(b.dataset.riskscore) - Number(a.dataset.riskscore);
        return a.dataset.name.localeCompare(b.dataset.name);
      });
      shown.forEach(card => grid.appendChild(card));
    }

    function copyText(text, btn) {
      navigator.clipboard.writeText(text).then(() => {
        const orig = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = orig; btn.classList.remove('copied'); }, 1800);
      }).catch(() => {
        // Fallback: select text in pre
        const pre = btn.closest('.install-block')?.querySelector('pre') ||
                    btn.closest('.plugscout-install')?.querySelector('code');
        if (pre) {
          const sel = window.getSelection();
          const range = document.createRange();
          range.selectNodeContents(pre);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      });
    }

    // Initial render
    applyFilters();
  </script>
</body>
</html>`;
}

function renderDetailCard(
  entry: {
    item: CatalogItem;
    assessment: RiskAssessment;
    blocked: boolean;
    approved: boolean;
    insight?: ItemInsight;
  }
): string {
  const trustScore = computeTrustScore(entry.item);
  const status = entry.blocked ? 'blocked' : entry.approved ? 'approved' : 'allowed';
  const statusClass = entry.blocked ? 'bad' : 'ok';
  const installHint = buildInstallHint(entry.item);
  const bestFor = entry.insight?.bestFor ?? [];
  const tradeoffs = entry.insight?.tradeoffs ?? [];
  const benefitSummary = entry.insight?.benefitSummary ?? '';

  const riskClass =
    entry.assessment.riskTier === 'low'
      ? 'ok'
      : entry.assessment.riskTier === 'medium'
        ? 'warn'
        : 'bad';

  const safeId = entry.item.id.replace(/[^a-zA-Z0-9-_]/g, '_');
  const bodyId = `body-${safeId}`;
  const searchKey = escapeHtml(`${entry.item.id} ${entry.item.name} ${entry.item.capabilities.join(' ')}`.toLowerCase());
  const plugscoutCmd = `plugscout install --id ${entry.item.id} --yes`;
  const previewChips = entry.item.capabilities
    .slice(0, 3)
    .map((cap) => `<span class="chip">${escapeHtml(cap)}</span>`)
    .join('');
  const allChips = entry.item.capabilities.length > 0
    ? entry.item.capabilities.map((cap) => `<span class="chip">${escapeHtml(cap)}</span>`).join('')
    : '<span class="chip">no capability tags</span>';

  return `<article class="detail-card${entry.blocked ? ' is-blocked' : ''}" role="listitem"
    data-search="${searchKey}"
    data-kind="${escapeHtml(entry.item.kind)}"
    data-risk="${escapeHtml(entry.assessment.riskTier)}"
    data-status="${escapeHtml(status)}"
    data-name="${escapeHtml(entry.item.name.toLowerCase())}"
    data-trust="${trustScore.toFixed(0)}"
    data-riskscore="${entry.assessment.riskScore.toFixed(0)}">
    <button class="card-header" onclick="toggleCard(this)" aria-expanded="false" aria-controls="${bodyId}" type="button">
      <div class="card-title-row">
        <h3 class="title">${escapeHtml(entry.item.name)}</h3>
        <span class="pill">${escapeHtml(entry.item.kind)}</span>
      </div>
      <div class="meta">${escapeHtml(entry.item.id)}</div>
      <div class="pill-row">
        <span class="pill">trust: ${trustScore.toFixed(0)}</span>
        <span class="pill ${riskClass}">risk: ${escapeHtml(entry.assessment.riskTier)}&nbsp;(${entry.assessment.riskScore.toFixed(0)})</span>
        <span class="pill ${statusClass}">${escapeHtml(status)}</span>
      </div>
      ${previewChips ? `<div class="chips">${previewChips}</div>` : ''}
      <div class="expand-hint">▼ details</div>
    </button>
    <div class="card-body" id="${bodyId}">
      <div class="line">${escapeHtml(entry.item.description)}</div>
      ${benefitSummary ? `<div class="line"><span class="label">What it does: </span>${escapeHtml(benefitSummary)}</div>` : ''}
      ${bestFor.length > 0 ? `<div class="line"><span class="label">Best for: </span>${escapeHtml(bestFor.join(' · '))}</div>` : ''}
      ${tradeoffs.length > 0 ? `<div class="line"><span class="label">Tradeoffs: </span>${escapeHtml(tradeoffs.join(' · '))}</div>` : ''}
      ${entry.item.capabilities.length > 0 ? `<div class="line"><span class="label">Capabilities: </span></div><div class="chips" style="margin-top:6px">${allChips}</div>` : ''}
      <div class="line">
        <span class="label">Trust:</span> ${trustScore.toFixed(0)}/100 (${escapeHtml(describeTrustBand(trustScore))}) &nbsp;·&nbsp;
        <span class="label">Risk:</span> ${entry.assessment.riskScore.toFixed(0)}/100 — ${escapeHtml(entry.assessment.riskTier)} &nbsp;·&nbsp;
        <span class="label">Status:</span> ${escapeHtml(status)}
      </div>
      ${entry.assessment.reasons.length > 0 ? `<div class="line"><span class="label">Risk signals: </span>${escapeHtml(entry.assessment.reasons.join(' · '))}</div>` : ''}
      <div class="line"><span class="label">Provider:</span> ${escapeHtml(entry.item.provider)} &nbsp;·&nbsp; <span class="label">Source:</span> ${escapeHtml(entry.item.source)}</div>
      ${buildItemLinks(entry.item).map(l => `<div class="line"><span class="label">${escapeHtml(l.label)}: </span><a class="link" href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.url)}</a></div>`).join('')}
      <div class="install-block">
        <div class="install-header">
          <span class="install-label">Install command</span>
          <button class="copy-btn" type="button" onclick="copyText(${JSON.stringify(installHint)}, this)">Copy</button>
        </div>
        <pre class="install-pre">${escapeHtml(installHint)}</pre>
      </div>
      <div class="plugscout-install">
        <code>${escapeHtml(plugscoutCmd)}</code>
        <button class="copy-btn" type="button" onclick="copyText(${JSON.stringify(plugscoutCmd)}, this)">Copy</button>
      </div>
    </div>
  </article>`;
}

function buildInstallHint(item: CatalogItem): string {
  if (item.install.kind === 'manual') {
    if (item.install.url) {
      return `Manual install: ${item.install.url}`;
    }
    return `Manual install: ${item.install.instructions}`;
  }

  const args = item.install.args.length > 0 ? ` ${item.install.args.join(' ')}` : '';
  return `${item.install.kind} ${item.install.target}${args}`;
}

function computeTrustScore(item: CatalogItem): number {
  return (item.maintenanceSignal + item.provenanceSignal + item.adoptionSignal) / 3;
}

function describeTrustBand(score: number): string {
  if (score >= 80) {
    return 'high confidence';
  }
  if (score >= 60) {
    return 'moderate confidence';
  }
  return 'needs review';
}


function formatRiskScale(policy: SecurityPolicy): string {
  const low = policy.thresholds.lowMax;
  const medium = policy.thresholds.mediumMax;
  const high = policy.thresholds.highMax;
  return `low 0-${low}, medium ${low + 1}-${medium}, high ${medium + 1}-${high}, critical ${high + 1}-${policy.thresholds.criticalMax}; install gate blocks: ${policy.installGate.blockTiers.join(', ')}.`;
}

function asMetadata(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

function buildItemLinks(item: CatalogItem): Array<{label: string; url: string}> {
  const meta = asMetadata(item.metadata);
  const links: Array<{label: string; url: string}> = [];
  const seen = new Set<string>();

  function add(label: string, url: unknown): void {
    if (typeof url !== 'string' || !url.startsWith('http')) return;
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  }

  if (item.kind === 'cursor-extension') {
    const vsixId = meta.vsixId;
    if (typeof vsixId === 'string') {
      add('Marketplace', `https://marketplace.visualstudio.com/items?itemName=${vsixId}`);
    }
  }
  if (item.kind === 'gemini-extension') {
    const pkg = meta.npmPackage;
    if (typeof pkg === 'string') {
      add('npm', `https://www.npmjs.com/package/${encodeURIComponent(pkg)}`);
    }
  }

  add('Install page', (item.install as Record<string, unknown>).url);
  add('Repository', meta.repositoryUrl);
  add('Repository', meta.githubUrl);
  if (typeof meta.sourceRepo === 'string' && meta.sourceRepo.startsWith('http')) {
    add('Repository', meta.sourceRepo);
  } else if (typeof meta.sourceRepo === 'string' && meta.sourceRepo.includes('/')) {
    add('Repository', `https://github.com/${meta.sourceRepo}`);
  }
  add('Website', meta.websiteUrl);
  add('Source page', meta.sourcePage);

  return links;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function countByKind(items: CatalogItem[]): Record<CatalogKind, number> {
  return items.reduce<Record<CatalogKind, number>>(
    (acc, item) => {
      acc[item.kind] += 1;
      return acc;
    },
    {
      skill: 0,
      mcp: 0,
      'claude-plugin': 0,
      'claude-connector': 0,
      'copilot-extension': 0,
      'cursor-extension': 0,
      'gemini-extension': 0
    }
  );
}
