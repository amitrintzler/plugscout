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
  const filtered = filterByKinds(items, options.kinds).slice(0, options.limit);
  const quarantineIds = new Set(quarantine.map((entry) => entry.id));
  const rows = filtered.map((item) => {
    const assessment = buildAssessment(item, policy);
    const blockedByPolicy = assessment.riskTier === 'high' || assessment.riskTier === 'critical';
    const blocked = blockedByPolicy || quarantineIds.has(item.id);
    return { item, assessment, blocked, approved: whitelist.has(item.id), insight: insights.get(item.id) };
  });

  const html = renderHtml(
    rows,
    {
      totalItems: filtered.length,
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
  stats: { totalItems: number; whitelist: number; quarantined: number },
  policy: SecurityPolicy
): string {
  const kindCounts = countByKind(rows.map((entry) => entry.item));
  const riskScale = escapeHtml(formatRiskScale(policy));
  const cardsJson = rows.map((entry) => renderDetailCard(entry, policy)).join('\n');

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
      --panel: #0e1628;
      --line: #22314d;
      --text: #e5edf8;
      --muted: #a8b6cc;
      --ok: #22c55e;
      --warn: #f59e0b;
      --bad: #ef4444;
      --accent: #60a5fa;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: var(--text);
      background: radial-gradient(circle at top, #111b33 0%, var(--bg) 45%);
      padding: 28px;
    }
    .wrap { max-width: 1460px; margin: 0 auto; }
    h1 { margin: 0 0 8px; font-size: 34px; }
    .sub { color: var(--muted); margin: 0 0 22px; }
    .stat-cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .stat-card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
    }
    .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .v { font-size: 26px; font-weight: 700; margin-top: 4px; }
    .legend {
      margin-bottom: 18px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px 16px;
      font-size: 13px;
      color: var(--muted);
    }
    /* Filter bar */
    .filter-bar {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px 16px;
      margin-bottom: 18px;
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      align-items: center;
    }
    .filter-bar input, .filter-bar select {
      background: #060f1d;
      border: 1px solid #2a3d5c;
      border-radius: 8px;
      color: var(--text);
      padding: 7px 10px;
      font-size: 13px;
      outline: none;
    }
    .filter-bar input { flex: 1; min-width: 160px; }
    .filter-bar input::placeholder { color: var(--muted); }
    .filter-bar select:focus, .filter-bar input:focus { border-color: var(--accent); }
    #result-count { color: var(--muted); font-size: 13px; margin-left: auto; white-space: nowrap; }
    /* Grid */
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
      gap: 12px;
    }
    /* Cards */
    .detail-card {
      border: 1px solid #243654;
      border-radius: 10px;
      background: #081121;
      overflow: hidden;
      transition: border-color 0.15s;
    }
    .detail-card:hover { border-color: #3a5a8a; }
    .card-header {
      padding: 14px;
      cursor: pointer;
      user-select: none;
    }
    .card-header:hover { background: rgba(255,255,255,0.03); }
    .card-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
      margin-bottom: 4px;
    }
    .title { margin: 0; font-size: 16px; line-height: 1.3; }
    .meta { color: var(--muted); font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; margin-bottom: 8px; }
    .pill-row { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
    .pill {
      display: inline-block;
      border-radius: 999px;
      border: 1px solid #314664;
      padding: 2px 9px;
      font-size: 12px;
      color: var(--text);
      white-space: nowrap;
    }
    .ok { color: var(--ok); border-color: #166534; }
    .warn { color: var(--warn); border-color: #854d0e; }
    .bad { color: var(--bad); border-color: #7f1d1d; }
    .chips { display: flex; flex-wrap: wrap; gap: 5px; }
    .chip {
      border: 1px solid #2f476b;
      border-radius: 999px;
      padding: 2px 8px;
      color: #c9dbf5;
      font-size: 12px;
    }
    .expand-hint {
      font-size: 11px;
      color: #4a6a94;
      margin-top: 8px;
      text-align: right;
    }
    .detail-card.expanded .expand-hint { display: none; }
    /* Expanded body */
    .card-body {
      display: none;
      padding: 0 14px 14px;
      border-top: 1px solid #1a2c44;
    }
    .detail-card.expanded .card-body { display: block; }
    .line { margin-top: 9px; color: var(--text); font-size: 14px; }
    .line .label { color: var(--muted); }
    .link { color: #93c5fd; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 13px; }
    pre {
      margin: 10px 0 0;
      padding: 9px 10px;
      border: 1px solid #243654;
      border-radius: 8px;
      background: #060f1d;
      overflow-x: auto;
      color: #dbeafe;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
    }
    .hidden { display: none !important; }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>PlugScout Web Report</h1>
    <p class="sub">Claude plugins · Claude connectors · Copilot extensions · Cursor extensions · Gemini extensions · Skills · MCP servers</p>

    <div class="stat-cards">
      <div class="stat-card"><div class="k">Total</div><div class="v">${stats.totalItems}</div></div>
      <div class="stat-card"><div class="k">Plugins</div><div class="v">${kindCounts['claude-plugin']}</div></div>
      <div class="stat-card"><div class="k">Connectors</div><div class="v">${kindCounts['claude-connector']}</div></div>
      <div class="stat-card"><div class="k">Copilot Ext</div><div class="v">${kindCounts['copilot-extension']}</div></div>
      <div class="stat-card"><div class="k">Cursor Ext</div><div class="v">${kindCounts['cursor-extension']}</div></div>
      <div class="stat-card"><div class="k">Gemini Ext</div><div class="v">${kindCounts['gemini-extension']}</div></div>
      <div class="stat-card"><div class="k">Skills</div><div class="v">${kindCounts.skill}</div></div>
      <div class="stat-card"><div class="k">MCP Servers</div><div class="v">${kindCounts.mcp}</div></div>
      <div class="stat-card"><div class="k">Whitelist / Quarantine</div><div class="v">${stats.whitelist} / ${stats.quarantined}</div></div>
    </div>

    <div class="legend">
      <strong>Scores:</strong>
      Trust 0–100 (higher = more trustworthy) &nbsp;·&nbsp;
      Risk 0–100 (lower = safer) &nbsp;·&nbsp;
      ${riskScale} &nbsp;·&nbsp;
      <span style="color:var(--bad)">blocked</span> = high/critical risk or quarantined
    </div>

    <div class="filter-bar">
      <input id="search" type="text" placeholder="Search by name or ID…" oninput="applyFilters()" />
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
      <select id="risk-filter" onchange="applyFilters()">
        <option value="">All risk tiers</option>
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
        <option value="critical">Critical</option>
      </select>
      <select id="status-filter" onchange="applyFilters()">
        <option value="">All statuses</option>
        <option value="allowed">Allowed</option>
        <option value="approved">Approved</option>
        <option value="blocked">Blocked</option>
      </select>
      <select id="sort-by" onchange="applyFilters()">
        <option value="name">Sort: Name A–Z</option>
        <option value="trust-desc">Sort: Trust ↓</option>
        <option value="risk-asc">Sort: Risk ↑ (safest first)</option>
        <option value="risk-desc">Sort: Risk ↓ (riskiest first)</option>
      </select>
      <span id="result-count"></span>
    </div>

    <div class="detail-grid" id="card-grid">
      ${cardsJson}
    </div>
  </div>

  <script>
    function toggleCard(header) {
      header.closest('.detail-card').classList.toggle('expanded');
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

      document.getElementById('result-count').textContent = 'Showing ' + visible + ' of ' + cards.length;

      const shown = cards.filter(c => !c.classList.contains('hidden'));
      shown.sort((a, b) => {
        if (sort === 'name') return a.dataset.name.localeCompare(b.dataset.name);
        if (sort === 'trust-desc') return Number(b.dataset.trust) - Number(a.dataset.trust);
        if (sort === 'risk-asc') return Number(a.dataset.riskscore) - Number(b.dataset.riskscore);
        if (sort === 'risk-desc') return Number(b.dataset.riskscore) - Number(a.dataset.riskscore);
        return a.dataset.name.localeCompare(b.dataset.name);
      });
      shown.forEach(card => grid.appendChild(card));
    }

    // Initial count
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
  },
  policy: SecurityPolicy
): string {
  const metadata = asMetadata(entry.item.metadata);
  const trustScore = computeTrustScore(entry.item);
  const confidence = stringOr(metadata.sourceConfidence, 'official');
  const catalogType = stringOr(metadata.catalogType, 'standard');
  const sourceRepo = typeof metadata.sourceRepo === 'string' ? metadata.sourceRepo : '';
  const sourcePage = typeof metadata.sourcePage === 'string' ? metadata.sourcePage : '';
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

  const searchKey = escapeHtml(`${entry.item.id} ${entry.item.name} ${entry.item.capabilities.join(' ')}`.toLowerCase());

  const previewChips = entry.item.capabilities
    .slice(0, 3)
    .map((cap) => `<span class="chip">${escapeHtml(cap)}</span>`)
    .join('');
  const allChips = entry.item.capabilities.length > 0
    ? entry.item.capabilities.map((cap) => `<span class="chip">${escapeHtml(cap)}</span>`).join('')
    : '<span class="chip">no capability tags</span>';

  return `<article class="detail-card"
    data-search="${searchKey}"
    data-kind="${escapeHtml(entry.item.kind)}"
    data-risk="${escapeHtml(entry.assessment.riskTier)}"
    data-status="${escapeHtml(status)}"
    data-name="${escapeHtml(entry.item.name.toLowerCase())}"
    data-trust="${trustScore.toFixed(0)}"
    data-riskscore="${entry.assessment.riskScore.toFixed(0)}">
    <div class="card-header" onclick="toggleCard(this)">
      <div class="card-title-row">
        <h3 class="title">${escapeHtml(entry.item.name)}</h3>
        <span class="pill">${escapeHtml(entry.item.kind)}</span>
      </div>
      <div class="meta">${escapeHtml(entry.item.id)}</div>
      <div class="pill-row">
        <span class="pill">trust: ${trustScore.toFixed(0)}</span>
        <span class="pill ${riskClass}">risk: ${escapeHtml(entry.assessment.riskTier)} (${entry.assessment.riskScore.toFixed(0)})</span>
        <span class="pill ${statusClass}">${escapeHtml(status)}</span>
      </div>
      ${previewChips ? `<div class="chips">${previewChips}</div>` : ''}
      <div class="expand-hint">▼ click for details</div>
    </div>
    <div class="card-body">
      <div class="line">${escapeHtml(entry.item.description)}</div>
      ${benefitSummary ? `<div class="line"><span class="label">What it does:</span> ${escapeHtml(benefitSummary)}</div>` : ''}
      ${bestFor.length > 0 ? `<div class="line"><span class="label">Best for:</span> ${escapeHtml(bestFor.join('; '))}</div>` : ''}
      ${tradeoffs.length > 0 ? `<div class="line"><span class="label">Tradeoffs:</span> ${escapeHtml(tradeoffs.join('; '))}</div>` : ''}
      <div class="line"><span class="label">Capabilities:</span></div>
      <div class="chips" style="margin-top:6px">${allChips}</div>
      <div class="line"><span class="label">Decision:</span> trust ${trustScore.toFixed(0)}/100 (${escapeHtml(describeTrustBand(trustScore))}), risk ${entry.assessment.riskScore.toFixed(0)}/100 (${escapeHtml(entry.assessment.riskTier)}; ${escapeHtml(describeRiskBand(entry.assessment.riskScore, policy))}), status ${escapeHtml(status)}.</div>
      <div class="line"><span class="label">Risk reasons:</span> ${escapeHtml(entry.assessment.reasons.join('; '))}</div>
      <div class="line"><span class="label">Provenance:</span> provider=${escapeHtml(entry.item.provider)} source=${escapeHtml(entry.item.source)} confidence=${escapeHtml(confidence)} catalog=${escapeHtml(catalogType)}</div>
      ${sourceRepo ? `<div class="line"><span class="label">Source repo:</span> <a class="link" href="${escapeHtml(sourceRepo)}" target="_blank" rel="noopener">${escapeHtml(sourceRepo)}</a></div>` : ''}
      ${sourcePage ? `<div class="line"><span class="label">Source page:</span> <a class="link" href="${escapeHtml(sourcePage)}" target="_blank" rel="noopener">${escapeHtml(sourcePage)}</a></div>` : ''}
      <pre class="mono">${escapeHtml(installHint)}</pre>
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

function describeRiskBand(score: number, policy: SecurityPolicy): string {
  if (score <= policy.thresholds.lowMax) {
    return 'low-risk zone';
  }
  if (score <= policy.thresholds.mediumMax) {
    return 'medium-risk zone';
  }
  if (score <= policy.thresholds.highMax) {
    return 'high-risk zone';
  }
  return 'critical-risk zone';
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

function stringOr(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return fallback;
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
