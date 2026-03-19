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
  const topClaude = rows.filter((entry) => entry.item.kind === 'claude-plugin').slice(0, 15);
  const topConnectors = rows.filter((entry) => entry.item.kind === 'claude-connector').slice(0, 15);
  const topCopilot = rows.filter((entry) => entry.item.kind === 'copilot-extension').slice(0, 15);
  const allRows = rows.slice(0, 120);
  const detailRows = rows.slice(0, 80);
  const riskScale = escapeHtml(formatRiskScale(policy));

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
    .cards {
      display: grid;
      grid-template-columns: repeat(3, minmax(180px, 1fr));
      gap: 12px;
      margin-bottom: 18px;
    }
    .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 14px;
    }
    .k { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em; }
    .v { font-size: 26px; font-weight: 700; margin-top: 4px; }
    .section {
      margin-top: 18px;
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 12px;
      overflow: hidden;
    }
    .section-body { padding: 14px 16px; }
    .section h2 {
      margin: 0;
      padding: 14px 16px;
      font-size: 18px;
      border-bottom: 1px solid var(--line);
      color: var(--accent);
    }
    table { width: 100%; border-collapse: collapse; }
    th, td {
      text-align: left;
      padding: 10px 12px;
      border-bottom: 1px solid #1d2a41;
      vertical-align: top;
      word-break: break-word;
    }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; }
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
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 13px; }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
      gap: 12px;
      padding: 14px;
    }
    .detail-card {
      border: 1px solid #243654;
      border-radius: 10px;
      background: #081121;
      padding: 12px;
    }
    .detail-head {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 10px;
      margin-bottom: 8px;
    }
    .title {
      margin: 0;
      font-size: 16px;
      line-height: 1.3;
    }
    .meta {
      color: var(--muted);
      font-size: 12px;
      margin-top: 4px;
    }
    .line { margin-top: 8px; color: var(--text); }
    .line .label { color: var(--muted); }
    .chips { margin-top: 8px; display: flex; flex-wrap: wrap; gap: 6px; }
    .chip {
      border: 1px solid #2f476b;
      border-radius: 999px;
      padding: 2px 8px;
      color: #c9dbf5;
      font-size: 12px;
    }
    .link { color: #93c5fd; text-decoration: none; }
    .link:hover { text-decoration: underline; }
    pre {
      margin: 8px 0 0;
      padding: 9px 10px;
      border: 1px solid #243654;
      border-radius: 8px;
      background: #060f1d;
      overflow-x: auto;
      color: #dbeafe;
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>PlugScout Web Report</h1>
    <p class="sub">Readable catalog view for Claude plugins, Claude connectors, Copilot extensions, Skills, and MCP servers.</p>
    <div class="cards">
      <div class="card"><div class="k">Items</div><div class="v">${stats.totalItems}</div></div>
      <div class="card"><div class="k">Claude Plugins</div><div class="v">${kindCounts['claude-plugin']}</div></div>
      <div class="card"><div class="k">Claude Connectors</div><div class="v">${kindCounts['claude-connector']}</div></div>
      <div class="card"><div class="k">Copilot Extensions</div><div class="v">${kindCounts['copilot-extension']}</div></div>
      <div class="card"><div class="k">Skills</div><div class="v">${kindCounts.skill}</div></div>
      <div class="card"><div class="k">MCP Servers</div><div class="v">${kindCounts.mcp}</div></div>
      <div class="card"><div class="k">Whitelist / Quarantine</div><div class="v">${stats.whitelist} / ${stats.quarantined}</div></div>
    </div>
    <section class="section">
      <h2>How to read scores</h2>
      <div class="section-body">
        <div><span class="pill ok">trust</span> 0-100, higher is better.</div>
        <div style="margin-top:6px;"><span class="pill warn">risk</span> 0-100, lower is safer. ${riskScale}</div>
        <div style="margin-top:6px;"><span class="pill bad">blocked</span> means policy high/critical risk or quarantined.</div>
      </div>
    </section>
    ${renderTableSection('Top Claude Plugins', topClaude)}
    ${renderTableSection('Top Claude Connectors', topConnectors)}
    ${renderTableSection('Top Copilot Extensions', topCopilot)}
    ${renderTableSection('Catalog Snapshot', allRows)}
    ${renderDetailSection('Decision details per item', detailRows, policy)}
  </div>
</body>
</html>`;
}

function renderTableSection(
  title: string,
  rows: Array<{
    item: CatalogItem;
    assessment: RiskAssessment;
    blocked: boolean;
    approved: boolean;
    insight?: ItemInsight;
  }>
): string {
  return `<section class="section">
  <h2>${escapeHtml(title)}</h2>
  <table>
    <thead>
      <tr>
        <th>ID</th>
        <th>Name</th>
        <th>Kind</th>
        <th>Provider</th>
        <th>Trust</th>
        <th>Source</th>
        <th>Confidence</th>
        <th>Risk</th>
        <th>Status</th>
      </tr>
    </thead>
    <tbody>
      ${rows
        .map((entry) => {
          const metadata = asMetadata(entry.item.metadata);
          const confidence = stringOr(metadata.sourceConfidence, 'official');
          const trustScore = computeTrustScore(entry.item);
          const riskClass =
            entry.assessment.riskTier === 'low'
              ? 'ok'
              : entry.assessment.riskTier === 'medium'
                ? 'warn'
                : 'bad';
          return `<tr>
            <td class="mono">${escapeHtml(entry.item.id)}</td>
            <td>${escapeHtml(entry.item.name)}</td>
            <td>${escapeHtml(entry.item.kind)}</td>
            <td>${escapeHtml(entry.item.provider)}</td>
            <td><span class="pill">${trustScore.toFixed(0)}</span></td>
            <td>${escapeHtml(entry.item.source)}</td>
            <td><span class="pill">${escapeHtml(confidence)}</span></td>
            <td><span class="pill ${riskClass}">${escapeHtml(entry.assessment.riskTier)} (${entry.assessment.riskScore.toFixed(0)})</span></td>
            <td>${entry.blocked ? '<span class="pill bad">blocked</span>' : entry.approved ? '<span class="pill ok">approved</span>' : '<span class="pill ok">allowed</span>'}</td>
          </tr>`;
        })
        .join('\n')}
    </tbody>
  </table>
</section>`;
}

function renderDetailSection(
  title: string,
  rows: Array<{
    item: CatalogItem;
    assessment: RiskAssessment;
    blocked: boolean;
    approved: boolean;
    insight?: ItemInsight;
  }>,
  policy: SecurityPolicy
): string {
  return `<section class="section">
  <h2>${escapeHtml(title)}</h2>
  <div class="detail-grid">
    ${rows.map((entry) => renderDetailCard(entry, policy)).join('\n')}
  </div>
</section>`;
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
  const installHint = buildInstallHint(entry.item);
  const bestFor = entry.insight?.bestFor ?? [];
  const tradeoffs = entry.insight?.tradeoffs ?? [];

  return `<article class="detail-card">
    <div class="detail-head">
      <div>
        <h3 class="title">${escapeHtml(entry.item.name)}</h3>
        <div class="meta mono">${escapeHtml(entry.item.id)}</div>
      </div>
      <div>
        <span class="pill">${escapeHtml(entry.item.kind)}</span>
      </div>
    </div>
    <div class="line">${escapeHtml(entry.item.description)}</div>
    <div class="line"><span class="label">Decision:</span> trust ${trustScore.toFixed(0)}/100 (${escapeHtml(describeTrustBand(trustScore))}), risk ${entry.assessment.riskScore.toFixed(0)}/100 (${escapeHtml(entry.assessment.riskTier)}; ${escapeHtml(describeRiskBand(entry.assessment.riskScore, policy))}), status ${escapeHtml(status)}.</div>
    <div class="line"><span class="label">Risk reasons:</span> ${escapeHtml(entry.assessment.reasons.join('; '))}</div>
    <div class="line"><span class="label">Provenance:</span> provider=${escapeHtml(entry.item.provider)} source=${escapeHtml(entry.item.source)} confidence=${escapeHtml(confidence)} catalog=${escapeHtml(catalogType)}</div>
    ${
      sourceRepo
        ? `<div class="line"><span class="label">Source repo:</span> <a class="link" href="${escapeHtml(sourceRepo)}">${escapeHtml(sourceRepo)}</a></div>`
        : ''
    }
    ${
      sourcePage
        ? `<div class="line"><span class="label">Source page:</span> <a class="link" href="${escapeHtml(sourcePage)}">${escapeHtml(sourcePage)}</a></div>`
        : ''
    }
    ${
      bestFor.length > 0
        ? `<div class="line"><span class="label">Best for:</span> ${escapeHtml(bestFor.join('; '))}</div>`
        : ''
    }
    ${
      tradeoffs.length > 0
        ? `<div class="line"><span class="label">Tradeoffs:</span> ${escapeHtml(tradeoffs.join('; '))}</div>`
        : ''
    }
    <div class="chips">${renderChips(entry.item.capabilities)}</div>
    <pre class="mono">${escapeHtml(installHint)}</pre>
  </article>`;
}

function renderChips(values: string[]): string {
  if (values.length === 0) {
    return '<span class="chip">no capability tags</span>';
  }

  return values
    .slice(0, 8)
    .map((value) => `<span class="chip">${escapeHtml(value)}</span>`)
    .join('');
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
      'copilot-extension': 0
    }
  );
}
