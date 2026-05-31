import path from 'node:path';
import fs from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { moveCursor, clearScreenDown } from 'node:readline';
import { spawn } from 'node:child_process';
import { stdin, stdout } from 'node:process';

import { loadItemInsights, loadRegistries, loadSecurityPolicy } from '../../config/runtime.js';
import { syncCatalogs } from '../../catalog/sync.js';
import { getStaleRegistries, loadSyncState } from '../../catalog/sync-state.js';
import { loadCatalogItemById, loadCatalogItems, loadQuarantine, loadWhitelist } from '../../catalog/repository.js';
import { computeSearchScore, searchCatalog } from '../../catalog/search.js';
import { installToolkitDependencies } from '../../install/dependencies.js';
import { installWithSkillSh } from '../../install/skillsh.js';
import { recordItemReview } from '../../install/review-state.js';
import { logger } from '../../lib/logger.js';
import { getPackagePath } from '../../lib/paths.js';
import { CatalogKindSchema, type CatalogItem, type CatalogKind, type Recommendation } from '../../lib/validation/contracts.js';
import { detectProjectSignals } from '../../recommendation/project-analysis.js';
import { recommend } from '../../recommendation/engine.js';
import { loadRequirementsProfile } from '../../recommendation/requirements.js';
import { assessRisk, buildAssessment } from '../../security/assessment.js';
import { runLiveChecks, formatLiveChecks } from '../../security/live-check.js';
import { applyQuarantineFromReport, verifyWhitelist } from '../../security/whitelist.js';
import { runDoctorChecks } from './doctor.js';
import { renderCsv } from './formatters/csv.js';
import { renderJson } from './formatters/json.js';
import { renderMarkdown } from './formatters/markdown.js';
import { colorRisk, colors } from './formatters/colors.js';
import { renderTable, scoreBar } from './formatters/table.js';
import { printHint, printJson } from './output.js';
import { hasFlag, readCsvList, readFlag, readKinds, readLimit, readSort, type SortKey } from './options.js';
import { renderHomeScreen, renderInteractiveHome } from './ui/home.js';
import { handleMcp } from './mcp.js';
import { writeWebReport } from './ui/web-report.js';
import {
  applyUpdate,
  checkForUpdateNow,
  maybeNotifyAboutUpdate,
  RELEASE_DOWNLOAD_URL,
  type ApplyUpdateResult,
  type UpdateCheckResult
} from './update-check.js';

interface LocalCliConfig {
  defaultKinds: CatalogKind[];
  defaultProviders: string[];
  riskPosture: 'balanced' | 'strict';
  outputStyle: 'rich-table' | 'json';
  initializedAt: string;
}

const COMMAND_ALIASES: Record<string, string> = {
  home: 'home',
  about: 'about',
  status: 'status',
  init: 'init',
  doctor: 'doctor',
  list: 'list',
  ls: 'list',
  show: 'show',
  inspect: 'show',
  info: 'show',
  details: 'show',
  search: 'search',
  find: 'search',
  explain: 'explain',
  why: 'explain',
  scan: 'scan',
  top: 'top',
  sync: 'sync',
  recommend: 'recommend',
  rec: 'recommend',
  reco: 'recommend',
  web: 'web',
  assess: 'assess',
  install: 'install',
  whitelist: 'whitelist',
  quarantine: 'quarantine',
  upgrade: 'upgrade',
  setup: 'setup',
  help: 'help',
  mcp: 'mcp',
  client: 'client',
};

export async function runCli(argv: string[]): Promise<void> {
  const noUpdateCheck = hasFlag(argv, '--no-update-check');
  const filtered = argv.filter((arg) => arg !== '--no-update-check');
  const [rawCommand = 'home', ...rest] = filtered;
  const command = normalizeCommand(rawCommand);

  if (!command) {
    printUnknownCommand(rawCommand);
    return;
  }

  switch (command) {
    case 'home':
      await handleHome();
      break;
    case 'about':
      await handleAbout();
      break;
    case 'status':
      await handleStatus(rest);
      break;
    case 'init':
      await handleInit(rest);
      break;
    case 'doctor':
      await handleDoctor(rest);
      break;
    case 'list':
      await handleList(rest);
      break;
    case 'show':
      await handleShow(rest);
      break;
    case 'search':
      await handleSearch(rest);
      break;
    case 'explain':
      await handleExplain(rest);
      break;
    case 'scan':
      await handleScan(rest);
      break;
    case 'top':
      await handleTop(rest);
      break;
    case 'sync':
      await handleSync(rest);
      break;
    case 'recommend':
      await handleRecommend(rest);
      break;
    case 'web':
      await handleWeb(rest);
      break;
    case 'assess':
      await handleAssess(rest);
      break;
    case 'install':
      await handleInstall(rest);
      break;
    case 'whitelist':
      await handleWhitelist(rest);
      break;
    case 'quarantine':
      await handleQuarantine(rest);
      break;
    case 'upgrade':
      await handleUpgrade(rest);
      break;
    case 'setup':
      await handleSetup(rest);
      break;
    case 'mcp':
      await handleMcp(rest);
      return; // intentional: MCP server is long-lived; update banner would corrupt JSON-RPC stream
    case 'client':
      await handleClient(rest);
      break;
    case 'help':
      printHelp();
      break;
    default:
      printHelp();
      break;
  }

  if (command !== 'help' && command !== 'upgrade') {
    await maybeNotifyAboutUpdate({ disableAutoCheck: noUpdateCheck });
  }
}

async function handleHome(): Promise<void> {
  if (process.stdout.isTTY) {
    await renderInteractiveHome();
  } else {
    const output = await renderHomeScreen();
    console.log(output);
  }
}

async function handleAbout(): Promise<void> {
  const packageRaw = await fs.readFile(getPackagePath('package.json'), 'utf8');
  const pkg = JSON.parse(packageRaw) as { name?: string; version?: string; description?: string; author?: string };

  console.log(`${pkg.name ?? 'plugscout'} v${pkg.version ?? '0.0.0'}`);
  if (pkg.description) {
    console.log(pkg.description);
  }
  if (pkg.author) {
    console.log(`Author: ${pkg.author}`);
  }
  console.log('Scope: Claude plugins, Claude connectors, Copilot extensions, Cursor extensions, Gemini extensions, Skills, MCP servers');
  console.log('Ranking: trust-first (fit + trust - risk penalties + freshness bonus)');
  console.log('Meaning: top/recommend output is repo-aware guidance, not a global popularity leaderboard.');
  console.log('Install discipline: review each suggestion, check provenance and risk, and do not install blindly from rank alone.');
  console.log('Install gate: install requires a recent `show` or `assess` for the same item, unless --override-review is used.');
  console.log('Sources: official-first provider registries with local fallback');
}

async function handleStatus(args: string[]): Promise<void> {
  const verbose = hasFlag(args, '--verbose');
  const [items, whitelist, quarantine, syncState, policy] = await Promise.all([
    loadCatalogItems(),
    loadWhitelist(),
    loadQuarantine(),
    loadSyncState(),
    loadSecurityPolicy()
  ]);

  const kindCounts = new Map<string, number>();
  const providerCounts = new Map<string, number>();
  items.forEach((item) => {
    kindCounts.set(item.kind, (kindCounts.get(item.kind) ?? 0) + 1);
    providerCounts.set(item.provider, (providerCounts.get(item.provider) ?? 0) + 1);
  });

  console.log('Catalog Status');
  console.log(`Items: ${items.length}`);
  console.log(
    `Kinds: skill=${kindCounts.get('skill') ?? 0}, mcp=${kindCounts.get('mcp') ?? 0}, claude-plugin=${kindCounts.get('claude-plugin') ?? 0}, claude-connector=${kindCounts.get('claude-connector') ?? 0}, copilot-extension=${kindCounts.get('copilot-extension') ?? 0}, cursor-extension=${kindCounts.get('cursor-extension') ?? 0}, gemini-extension=${kindCounts.get('gemini-extension') ?? 0}`
  );
  console.log(
    `Providers: ${Array.from(providerCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, count]) => `${name}=${count}`)
      .join(', ')}`
  );
  console.log(`Whitelist approved: ${whitelist.size}`);
  console.log(`Quarantined: ${quarantine.length}`);

  const stale = getStaleRegistries(syncState);
  console.log(`Stale registries (>48h): ${stale.length === 0 ? 'none' : stale.join(', ')}`);
  if (items.length === 0) {
    printHint('Catalog is empty. Run `plugscout sync` or `npm run sync` to fetch the latest entries.');
  }

  if (verbose) {
    console.log('\nRegistry Sync State');
    const entries = Object.entries(syncState.registries).sort((a, b) => a[0].localeCompare(b[0]));
    if (entries.length === 0) {
      console.log('- none yet');
    } else {
      entries.forEach(([id, state]) => {
        console.log(`- ${id}: lastSuccessfulSyncAt=${state.lastSuccessfulSyncAt ?? 'n/a'}, updatedSince=${state.lastUpdatedSince ?? 'n/a'}`);
      });
    }

    const risks = items
      .map((item) => ({ id: item.id, assessment: buildAssessment(item, policy) }))
      .sort((a, b) => b.assessment.riskScore - a.assessment.riskScore)
      .slice(0, 5);

    console.log('\nTop Risks');
    risks.forEach((entry) => {
      console.log(`- ${entry.id}: ${entry.assessment.riskTier} (${entry.assessment.riskScore.toFixed(0)})`);
    });
  }
}

async function handleInit(args: string[]): Promise<void> {
  const project = readFlag(args, '--project') ?? '.';
  const root = path.resolve(project);

  const [items, policy] = await Promise.all([loadCatalogItems(), loadSecurityPolicy()]);
  const providers = Array.from(new Set(items.map((item) => item.provider))).sort((a, b) => a.localeCompare(b));

  const defaultKinds: CatalogKind[] = ['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension', 'cursor-extension', 'gemini-extension'];

  const defaults: LocalCliConfig = {
    defaultKinds,
    defaultProviders: providers,
    riskPosture: 'balanced',
    outputStyle: 'rich-table',
    initializedAt: new Date().toISOString()
  };

  if (stdout.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try {
      const kindsAnswer = await rl.question(
        `Default kinds [${defaults.defaultKinds.join(',')}] (comma list): `
      );
      if (kindsAnswer.trim().length > 0) {
        defaults.defaultKinds = kindsAnswer
          .split(',')
          .map((v) => CatalogKindSchema.parse(v.trim()));
      }

      const providerAnswer = await rl.question(
        `Default providers [${defaults.defaultProviders.join(',')}] (comma list): `
      );
      if (providerAnswer.trim().length > 0) {
        defaults.defaultProviders = providerAnswer
          .split(',')
          .map((v) => v.trim())
          .filter((v) => v.length > 0);
      }

      const riskAnswer = await rl.question(
        'Risk posture [balanced|strict] (default balanced; strict hides blocked/high-risk by default): '
      );
      if (riskAnswer.trim() === 'strict') {
        defaults.riskPosture = 'strict';
      }

      const formatAnswer = await rl.question('Default output [rich-table|json] (default rich-table): ');
      if (formatAnswer.trim() === 'json') {
        defaults.outputStyle = 'json';
      }

      const syncAnswer = await rl.question('Run initial sync now? [Y/n]: ');
      if (syncAnswer.trim().toLowerCase() !== 'n') {
        await syncCatalogs();
      }
    } finally {
      rl.close();
    }
  } else {
    logger.info('Non-interactive shell detected; writing default .skills-mcps.json');
  }

  const file = path.join(root, '.skills-mcps.json');
  await fs.writeFile(file, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');

  console.log(`Initialized local CLI config: ${file}`);
  console.log(`Risk scale (lower is safer): ${formatRiskScale(policy)}`);
  console.log(
    `Risk posture "${defaults.riskPosture}": ${describeRiskPosture(defaults.riskPosture)}`
  );
  printHint('Next: run `npm run doctor`, then `npm run recommend -- --project . --only-safe --limit 10`.');
}

async function handleSetup(args: string[]): Promise<void> {
  const project = readFlag(args, '--project') ?? '.';
  const root = path.resolve(project);

  console.log('PlugScout setup');
  console.log('');

  // Step 1: install dependencies
  console.log('Step 1/3: Installing prerequisites...');
  const installed = await installToolkitDependencies();
  if (installed.length === 0) {
    console.log('  Prerequisites already satisfied.');
  } else {
    console.log(`  Installed: ${installed.join(', ')}`);
  }
  console.log('');

  // Step 2: write default config (non-interactive)
  console.log('Step 2/3: Initializing local config...');
  const [items, policy] = await Promise.all([loadCatalogItems(), loadSecurityPolicy()]);
  const providers = Array.from(new Set(items.map((item) => item.provider))).sort((a, b) => a.localeCompare(b));
  const defaultKinds: CatalogKind[] = ['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension', 'cursor-extension', 'gemini-extension'];
  const defaults = {
    defaultKinds,
    defaultProviders: providers,
    riskPosture: 'balanced' as const,
    outputStyle: 'rich-table' as const,
    initializedAt: new Date().toISOString()
  };
  const configFile = path.join(root, '.skills-mcps.json');
  await fs.writeFile(configFile, `${JSON.stringify(defaults, null, 2)}\n`, 'utf8');
  console.log(`  Config written: ${configFile}`);
  console.log(`  Risk posture: ${defaults.riskPosture} — ${describeRiskPosture(defaults.riskPosture)}`);
  console.log(`  Risk scale: ${formatRiskScale(policy)}`);
  console.log('');

  // Step 3: sync catalogs
  console.log('Step 3/3: Syncing catalogs...');
  const result = await syncCatalogs();
  console.log(`  Synced ${result.items.length} items.`);
  if (result.staleRegistries.length > 0) {
    logger.warn(`  Stale registries: ${result.staleRegistries.join(', ')}`);
  }
  console.log('');

  // Doctor summary
  console.log('Health check:');
  const checks = await runDoctorChecks(project);
  const failed = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');
  checks.forEach((c) => {
    const icon = c.status === 'pass' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
    console.log(`  ${icon} ${c.name}: ${c.message}`);
  });
  console.log('');

  if (failed.length > 0) {
    console.log(`Setup complete with ${failed.length} issue(s). Run \`plugscout doctor\` for details.`);
  } else if (warnings.length > 0) {
    console.log('Setup complete. Some warnings above — run `plugscout doctor` for details.');
  } else {
    console.log('Setup complete. You\'re ready to go!');
  }
  printHint('Next: plugscout recommend --project . --only-safe --limit 10');
}

async function handleDoctor(args: string[]): Promise<void> {
  const project = readFlag(args, '--project') ?? '.';
  const installDeps = hasFlag(args, '--install-deps');

  if (installDeps) {
    const installed = await installToolkitDependencies();
    if (installed.length === 0) {
      console.log('Dependency bootstrap: nothing to install.');
    } else {
      console.log(`Dependency bootstrap installed: ${installed.join(', ')}`);
    }
  }

  const checks = await runDoctorChecks(project);

  const table = renderTable(
    [
      { key: 'name', header: 'CHECK', width: 22 },
      { key: 'status', header: 'STATUS', width: 8 },
      { key: 'message', header: 'MESSAGE', width: 48 },
      { key: 'suggestion', header: 'SUGGESTION', width: 42 }
    ],
    checks.map((check) => ({
      ...check,
      status:
        check.status === 'pass'
          ? colors.green('pass')
          : check.status === 'warn'
            ? colors.yellow('warn')
            : colors.red('fail'),
      suggestion: check.suggestion ?? ''
    }))
  );

  console.log(table);

  const failCount = checks.filter((c) => c.status === 'fail').length;
  if (failCount > 0) {
    printHint('Resolve failing checks before installation workflows.');
    throw new Error(`Doctor found ${failCount} failing checks.`);
  }
}

async function handleList(args: string[]): Promise<void> {
  const kinds = readKinds(args);
  const providers = readCsvList(args, '--provider');
  const search = readFlag(args, '--search')?.toLowerCase();
  const blockedFilter = readFlag(args, '--blocked');
  const riskTierFilter = readFlag(args, '--risk-tier');
  const limit = readLimit(args, 50);
  const sort = readSort(args, 'name');
  const format = readFlag(args, '--format') ?? 'table';
  const readable = hasFlag(args, '--readable');
  const details = hasFlag(args, '--details');

  const [items, quarantine, policy, localConfig, insights] = await Promise.all([
    loadCatalogItems(),
    loadQuarantine(),
    loadSecurityPolicy(),
    loadLocalCliConfig(path.resolve('.')),
    loadItemInsights()
  ]);
  const quarantined = new Set(quarantine.map((entry) => entry.id));

  let filtered = items.map((item) => {
    const assessment = buildAssessment(item, policy);
    const blocked = quarantined.has(item.id) || ['high', 'critical'].includes(assessment.riskTier);
    return {
      item,
      assessment,
      blocked
    };
  });

  if (kinds?.length) {
    const set = new Set(kinds);
    filtered = filtered.filter((entry) => set.has(entry.item.kind));
  }

  if (providers?.length) {
    const set = new Set(providers.map((p) => p.toLowerCase()));
    filtered = filtered.filter((entry) => set.has(entry.item.provider.toLowerCase()));
  }

  if (search) {
    filtered = filtered.filter((entry) => {
      const text = `${entry.item.id} ${entry.item.name} ${entry.item.capabilities.join(' ')}`.toLowerCase();
      return text.includes(search);
    });
  }

  if (blockedFilter) {
    const required = blockedFilter === 'true';
    filtered = filtered.filter((entry) => entry.blocked === required);
  } else if (localConfig?.riskPosture === 'strict') {
    filtered = filtered.filter((entry) => !entry.blocked);
  }

  if (riskTierFilter) {
    filtered = filtered.filter((entry) => entry.assessment.riskTier === riskTierFilter);
  }

  filtered = sortCatalogRows(filtered, sort).slice(0, limit ?? 50);

  if (filtered.length === 0) {
    console.log('No catalog items matched your filters.');
    printHint('Try a broader query, remove `--blocked/--risk-tier`, or use `plugscout search <term>`.');
    return;
  }

  if (format === 'json') {
    printJson(
      filtered.map((entry) => ({
        id: entry.item.id,
        kind: entry.item.kind,
        provider: entry.item.provider,
        source: entry.item.source,
        catalogType: getCatalogType(entry.item),
        sourceConfidence: getSourceConfidence(entry.item),
        riskTier: entry.assessment.riskTier,
        riskScore: entry.assessment.riskScore,
        blocked: entry.blocked
      }))
    );
    return;
  }

  console.log(
    renderTable(
      [
        { key: 'id', header: 'ID', width: readable ? 42 : 32 },
        { key: 'kind', header: 'TYPE', width: 18 },
        { key: 'provider', header: 'PROVIDER', width: 10 },
        { key: 'source', header: 'SOURCE', width: readable ? 34 : 24 },
        { key: 'catalogType', header: 'CATALOG', width: 10 },
        { key: 'confidence', header: 'CONFIDENCE', width: 14 },
        { key: 'risk', header: 'RISK', width: 12 },
        { key: 'blocked', header: 'BLOCKED', width: 8 }
      ],
      filtered.map((entry) => ({
        id: entry.item.id,
        kind: entry.item.kind,
        provider: entry.item.provider,
        source: entry.item.source,
        catalogType: getCatalogType(entry.item),
        confidence: getSourceConfidence(entry.item),
        risk: `${entry.assessment.riskTier}(${entry.assessment.riskScore.toFixed(0)})`,
        blocked: String(entry.blocked)
      })),
      { wrap: readable }
    )
  );

  printHint(`Risk scale (lower is safer): ${formatRiskScale(policy)}`);
  if (!blockedFilter && localConfig?.riskPosture === 'strict') {
    printHint('Strict risk posture is active: blocked/high-risk entries are hidden. Use `--blocked true` to inspect them.');
  }
  printHint('Use `show --id <catalog-id>` for full detail.');
  if (details) {
    console.log(renderCatalogDecisionDetails(filtered, policy, insights));
  }

  await promptResultBrowser(filtered.map((e) => ({id: e.item.id, name: e.item.name, url: buildItemLinks(e.item)[0]?.url})));
}

async function handleShow(args: string[]): Promise<void> {
  const id = readFlag(args, '--id');
  if (!id) {
    throw new Error('Usage: show --id <catalog-id>');
  }
  const noLive = hasFlag(args, '--no-live');

  const [item, whitelist, quarantine, insights] = await Promise.all([
    loadCatalogItemById(id),
    loadWhitelist(),
    loadQuarantine(),
    loadItemInsights()
  ]);
  if (!item) {
    throw new Error(await buildCatalogItemNotFoundMessage(id));
  }

  const assessment = await assessRisk(item);
  const isQuarantined = quarantine.some((entry) => entry.id === item.id);
  const insight = insights.get(item.id);

  printJson({
    ...item,
    insight: insight ?? null,
    risk: {
      tier: assessment.riskTier,
      score: assessment.riskScore,
      reasons: assessment.reasons
    },
    policyStatus: {
      approvedInWhitelist: whitelist.has(item.id),
      quarantined: isQuarantined
    }
  });
  await recordItemReview(item.id, 'show');

  printHint(`Install with: plugscout install --id ${item.id} --yes`);
  printHint('Review provenance, risk, and capabilities first. Do not install blindly from a suggestion or score.');
  console.log(
    `Provenance: source=${item.source} catalogType=${getCatalogType(item)} confidence=${getSourceConfidence(item)}`
  );

  const links = buildItemLinks(item);
  if (links.length > 0) {
    console.log('\nLinks:');
    for (const link of links) {
      console.log(`  ${link.label}: ${link.url}`);
    }
  }

  if (!noLive) {
    process.stdout.write('\x1b[90mRunning live checks…\x1b[0m\r');
    const liveResults = await runLiveChecks(item);
    process.stdout.write('                        \r');
    const liveOutput = formatLiveChecks(liveResults);
    if (liveOutput) {
      console.log(liveOutput);
    }
  }
}

async function handleSearch(args: string[]): Promise<void> {
  const query = args[0]?.trim();
  if (!query) {
    throw new Error('Usage: search <query>');
  }

  const results = await searchCatalog(query, { limit: 20 });
  const matches = results.map((item) => ({ item, score: computeSearchScore(item, query.toLowerCase()) }));

  if (matches.length === 0) {
    console.log(`No matches for "${query}".`);
    printHint('Try a broader term or browse by kind with `plugscout list --kind connectors`, `plugscout list --kind plugins`, or `plugscout list --kind mcp`.');
    return;
  }

  console.log(
    renderTable(
      [
        { key: 'id', header: 'ID', width: 32 },
        { key: 'kind', header: 'TYPE', width: 18 },
        { key: 'provider', header: 'PROVIDER', width: 12 },
        { key: 'score', header: 'MATCH', width: 8 },
        { key: 'name', header: 'NAME', width: 34 }
      ],
      matches.map((entry) => ({
        id: entry.item.id,
        kind: entry.item.kind,
        provider: entry.item.provider,
        score: entry.score.toFixed(0),
        name: entry.item.name
      }))
    )
  );

  printHint('Use `show --id <catalog-id>` for full detail.');
  await promptResultBrowser(matches.map((e) => ({id: e.item.id, name: e.item.name, url: buildItemLinks(e.item)[0]?.url})));
}

async function handleExplain(args: string[]): Promise<void> {
  const kinds = readKinds(args);
  const providers = readCsvList(args, '--provider');
  const format = readFlag(args, '--format') ?? 'table';
  const limit = readLimit(args, 50) ?? 50;

  const [items, insights] = await Promise.all([loadCatalogItems(), loadItemInsights()]);
  let filtered = items;

  if (kinds?.length) {
    const set = new Set(kinds);
    filtered = filtered.filter((item) => set.has(item.kind));
  }

  if (providers?.length) {
    const set = new Set(providers.map((value) => value.toLowerCase()));
    filtered = filtered.filter((item) => set.has(item.provider.toLowerCase()));
  }

  const rows = filtered
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((item) => {
      const insight = insights.get(item.id);
      return {
        id: item.id,
        kind: item.kind,
        provider: item.provider,
        benefitSummary: insight?.benefitSummary ?? 'No insight data yet.',
        bestFor: (insight?.bestFor ?? []).join('; '),
        tradeoffs: (insight?.tradeoffs ?? []).join('; ')
      };
    });

  if (format === 'json') {
    printJson(rows);
    return;
  }

  console.log(
    renderTable(
      [
        { key: 'id', header: 'ID', width: 34 },
        { key: 'kind', header: 'TYPE', width: 18 },
        { key: 'provider', header: 'PROVIDER', width: 12 },
        { key: 'benefitSummary', header: 'BENEFIT', width: 56 }
      ],
      rows
    )
  );

  printHint('Use `show --id <catalog-id>` for full best-for, tradeoffs, and usage notes.');
}

async function handleScan(args: string[]): Promise<void> {
  const project = readFlag(args, '--project') ?? '.';
  const format = readFlag(args, '--format') ?? 'table';
  const llm = hasFlag(args, '--llm');
  const out = readFlag(args, '--out');

  const scan = await detectProjectSignals(path.resolve(project), { llm });
  const payload = {
    project: path.resolve(project),
    inferredArchetype: scan.inferredArchetype,
    inferenceConfidence: scan.inferenceConfidence,
    stack: scan.stack,
    compatibilityTags: scan.compatibilityTags,
    inferredCapabilities: scan.inferredCapabilities,
    archetypeScores: scan.archetypeScores,
    evidence: scan.scanEvidence
  };

  if (out) {
    await fs.writeFile(path.resolve(out), `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Wrote scan report to ${path.resolve(out)}`);
  }

  if (format === 'json') {
    printJson(payload);
    return;
  }

  const resolvedProject = path.resolve(project);
  const relProject = path.relative(process.cwd(), resolvedProject) || '.';
  const confidenceLabel = scan.inferenceConfidence >= 80 ? 'high' : scan.inferenceConfidence >= 50 ? 'medium' : 'low';

  console.log(`Scanned: ${relProject}  (${resolvedProject})`);
  console.log('');
  console.log(`  Archetype:    ${scan.inferredArchetype}  (confidence ${scan.inferenceConfidence}% — ${confidenceLabel})`);
  console.log(`  Stack:        ${scan.stack.join(', ') || 'none detected'}`);
  console.log(`  Capabilities: ${scan.inferredCapabilities.join(', ') || 'none inferred'}`);
  console.log(`  Tags:         ${scan.compatibilityTags.join(', ') || 'none'}`);
  console.log('');

  if (scan.archetypeScores.length > 0) {
    console.log('Archetype match scores (how well your project fits each pattern):');
    console.log(
      renderTable(
        [
          { key: 'name', header: 'ARCHETYPE', width: 36 },
          { key: 'score', header: 'SCORE', width: 8 }
        ],
        scan.archetypeScores.slice(0, 8).map((row) => ({
          name: row.name,
          score: String(row.score)
        }))
      )
    );
    console.log('');
  }

  if (scan.scanEvidence.length > 0) {
    console.log(`Evidence — ${scan.scanEvidence.length} signal(s) found in ${relProject}:`);
    scan.scanEvidence.slice(0, 16).forEach((line) => console.log(`  - ${line}`));
    if (scan.scanEvidence.length > 16) {
      console.log(`  - ...and ${scan.scanEvidence.length - 16} more`);
    }
    console.log('');
  }

  printHint(`Next: plugscout recommend --project ${relProject} --only-safe --limit 10`);
  printHint('Add --explain-scan to see how these signals shape recommendations.');
}

async function handleTop(args: string[]): Promise<void> {
  const project = readFlag(args, '--project') ?? '.';
  const requirementsFile = readFlag(args, '--requirements');
  const kinds = readKinds(args);
  const limit = readLimit(args, 10) ?? 10;
  const llm = hasFlag(args, '--llm');
  const readable = hasFlag(args, '--readable');
  const details = hasFlag(args, '--details');

  const [projectSignals, requirements, policy] = await Promise.all([
    detectProjectSignals(path.resolve(project), { llm }),
    loadRequirementsProfile(requirementsFile),
    loadSecurityPolicy()
  ]);

  const ranked = await recommend({ projectSignals, requirements, kinds });
  const safe = ranked.filter((entry) => !entry.blocked).slice(0, limit);

  renderRecommendationsTable(safe, 'table', readable);
  printHint('Ranking meaning: these are the best safe matches for this repo, not the globally most popular tools.');
  printHint('Score formula: fit + trust + freshness - security - blocked.');
  printHint('Review each suggestion before installing. Do not install blindly from rank alone.');
  printHint(`Risk scale (lower is safer): ${formatRiskScale(policy)}`);
  printHint('Use `show --id <catalog-id>` or `assess --id <catalog-id>` for deep inspection.');
  const topCatalogItems = await loadCatalogItems();
  const topCatalogMap = new Map(topCatalogItems.map((item) => [item.id, item]));
  if (details) {
    const insights = await loadItemInsights();
    console.log(renderRecommendationDecisionDetails(safe, topCatalogMap, policy, insights));
  }

  await promptResultBrowser(safe.map((e) => {
    const item = topCatalogMap.get(e.id);
    return {id: e.id, name: '', url: item ? buildItemLinks(item)[0]?.url : undefined};
  }));
}

async function handleSync(args: string[]): Promise<void> {
  const kinds = readKinds(args);
  const dryRun = hasFlag(args, '--dry-run');

  if (dryRun) {
    const registries = await loadRegistries();
    const selected = kinds?.length ? registries.filter((registry) => kinds.includes(registry.kind)) : registries;
    console.log('Sync Dry Run');
    selected.forEach((registry) => {
      console.log(`- ${registry.id} (${registry.kind}) entries=${registry.entries.length} remote=${registry.remote ? 'yes' : 'no'}`);
    });
    printHint('Run without --dry-run to persist synced catalogs.');
    return;
  }

  const result = await syncCatalogs(undefined, { kinds });

  if (result.staleRegistries.length > 0) {
    logger.warn(`Stale registries: ${result.staleRegistries.join(', ')}`);
  }
}

async function handleRecommend(args: string[]): Promise<void> {
  const project = readFlag(args, '--project') ?? '.';
  const requirementsFile = readFlag(args, '--requirements');
  const format = readFlag(args, '--format') ?? 'table';
  const kinds = readKinds(args);
  const providers = readCsvList(args, '--provider');
  const limit = readLimit(args);
  let onlySafe = hasFlag(args, '--only-safe');
  const sort = readSort(args);
  const exportFormat = readFlag(args, '--export');
  const exportPath = readFlag(args, '--out');
  const explainScan = hasFlag(args, '--explain-scan');
  const llm = hasFlag(args, '--llm');
  const readable = hasFlag(args, '--readable');
  const details = hasFlag(args, '--details');
  const projectRoot = path.resolve(project);

  const [projectSignals, requirements, policy, localConfig] = await Promise.all([
    detectProjectSignals(projectRoot, { llm }),
    loadRequirementsProfile(requirementsFile),
    loadSecurityPolicy(),
    loadLocalCliConfig(projectRoot)
  ]);

  if (!onlySafe && localConfig?.riskPosture === 'strict') {
    onlySafe = true;
    printHint('Strict risk posture is active: recommendations default to safe items only.');
  }

  if (explainScan) {
    const previewEvidence = projectSignals.scanEvidence.slice(0, 12);
    console.log('Project Scan');
    console.log(
      `- archetype: ${projectSignals.inferredArchetype} (${projectSignals.inferenceConfidence}% confidence)`
    );
    console.log(`- stack: ${projectSignals.stack.join(', ') || 'none'}`);
    console.log(`- compatibility tags: ${projectSignals.compatibilityTags.join(', ') || 'none'}`);
    console.log(
      `- inferred capabilities: ${projectSignals.inferredCapabilities.join(', ') || 'none'}`
    );
    if (previewEvidence.length > 0) {
      console.log('- evidence:');
      previewEvidence.forEach((line) => console.log(`  - ${line}`));
      if (projectSignals.scanEvidence.length > previewEvidence.length) {
        console.log(`  - ...and ${projectSignals.scanEvidence.length - previewEvidence.length} more`);
      }
    }
    console.log('');
  }

  let ranked = await recommend({ projectSignals, requirements, kinds });

  if (providers?.length) {
    const set = new Set(providers.map((provider) => provider.toLowerCase()));
    ranked = ranked.filter((entry) => set.has(entry.provider.toLowerCase()));
  }

  if (onlySafe) {
    ranked = ranked.filter((entry) => !entry.blocked);
  }

  ranked = sortRecommendations(ranked, sort);

  if (limit) {
    ranked = ranked.slice(0, limit);
  }

  if (format === 'json') {
    console.log(renderJson(ranked));
  } else {
    renderRecommendationsTable(ranked, format, readable);
    printHint('Ranking meaning: these are the best matches for this repo under the current policy, not a global leaderboard.');
    printHint('Score formula: fit + trust + freshness - security - blocked.');
    printHint('Review each suggestion before installing. Do not install blindly from rank alone.');
    printHint(`Risk scale (lower is safer): ${formatRiskScale(policy)}`);
    if (details) {
      const [catalogItems, insights] = await Promise.all([loadCatalogItems(), loadItemInsights()]);
      const catalogMap = new Map(catalogItems.map((item) => [item.id, item]));
      console.log(renderRecommendationDecisionDetails(ranked, catalogMap, policy, insights));
    }
  }

  if (details && format === 'json') {
    printHint('Detailed decision view is available in table mode: rerun with `--format table --details`.');
  }

  if (exportFormat) {
    if (!exportPath) {
      throw new Error('Missing --out for export. Example: --export csv --out recommendations.csv');
    }
    await exportRecommendations(ranked, exportFormat, exportPath);
    console.log(`Exported ${ranked.length} recommendations to ${exportPath}`);
  }

  printHint('Next: run `show --id <catalog-id>` or `install --id <catalog-id> --yes`.');

  if (format !== 'json') {
    const recCatalogItems = await loadCatalogItems();
    const recCatalogMap = new Map(recCatalogItems.map((item) => [item.id, item]));
    await promptResultBrowser(ranked.map((e) => {
      const item = recCatalogMap.get(e.id);
      return {id: e.id, name: '', url: item ? buildItemLinks(item)[0]?.url : undefined};
    }));
  }
}

async function handleWeb(args: string[]): Promise<void> {
  const out = readFlag(args, '--out') ?? '.plugscout/report.html';
  const limit = readLimit(args, 400) ?? 400;
  const kinds = readKinds(args);
  const open = hasFlag(args, '--open');

  const result = await writeWebReport({
    outputPath: out,
    kinds,
    limit
  });
  console.log(`Web report written: ${result.outputPath}`);
  console.log(`Items included: ${result.items}`);

  if (open) {
    const opened = await openInBrowser(result.outputPath);
    if (!opened) {
      printHint(`Unable to auto-open browser. Open manually: ${result.outputPath}`);
    }
  } else {
    printHint(`Open in browser: ${result.outputPath}`);
  }
}

async function handleAssess(args: string[]): Promise<void> {
  const id = readFlag(args, '--id');
  if (!id) {
    throw new Error('Missing --id for assess');
  }
  const noLive = hasFlag(args, '--no-live');

  const found = await loadCatalogItemById(id);
  if (!found) {
    throw new Error(await buildCatalogItemNotFoundMessage(id));
  }

  const [assessment, policy] = await Promise.all([assessRisk(found), loadSecurityPolicy()]);
  console.log(renderJson(assessment));
  await recordItemReview(found.id, 'assess');
  printHint(`Risk scale (lower is safer): ${formatRiskScale(policy)}`);

  const links = buildItemLinks(found);
  if (links.length > 0) {
    console.log('\nLinks:');
    for (const link of links) {
      console.log(`  ${link.label}: ${link.url}`);
    }
  }

  if (!noLive) {
    process.stdout.write('\x1b[90mRunning live checks…\x1b[0m\r');
    const liveResults = await runLiveChecks(found);
    process.stdout.write('                        \r');
    const liveOutput = formatLiveChecks(liveResults);
    if (liveOutput) {
      console.log(liveOutput);
    }
  }
}

async function handleInstall(args: string[]): Promise<void> {
  const id = readFlag(args, '--id');
  if (!id) {
    throw new Error('Missing --id for install');
  }

  const overrideRisk = hasFlag(args, '--override-risk');
  const overrideReview = hasFlag(args, '--override-review');
  const installDeps = hasFlag(args, '--install-deps');
  const yes = hasFlag(args, '--yes');
  const found = await loadCatalogItemById(id);
  if (!found) {
    throw new Error(await buildCatalogItemNotFoundMessage(id));
  }

  if (installDeps) {
    const installed = await installToolkitDependencies();
    if (installed.length > 0) {
      console.log(`Dependency bootstrap installed: ${installed.join(', ')}`);
    }
  }

  const audit = await installWithSkillSh({ id, overrideRisk, overrideReview, yes });
  console.log(renderJson(audit));
  printHint('Need ranking context? `top` and `recommend` are repo-aware suggestions, not global popularity charts.');
  printHint('Always review the item with `show` or `assess` first. Do not install blindly from a score.');
  printHint('Use `top --project . --details` to see score math for this repository.');
}

async function handleWhitelist(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== 'verify') {
    throw new Error('Usage: whitelist verify');
  }
  const allowFailures = hasFlag(args, '--allow-failures');

  const result = await verifyWhitelist();
  console.log(
    renderJson({
      reportPath: result.reportPath,
      failed: result.report.failed.length,
      staleRegistries: result.report.staleRegistries
    })
  );
  if (result.report.failed.length > 0 && !allowFailures) {
    throw new Error(`Whitelist verification failed (${result.report.failed.length} entries)`);
  }
}

async function handleQuarantine(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== 'apply') {
    throw new Error('Usage: quarantine apply --report <path>');
  }

  const report = readFlag(args, '--report');
  if (!report) {
    throw new Error('Missing --report for quarantine apply');
  }

  const result = await applyQuarantineFromReport(report);
  console.log(renderJson(result));
}

async function handleClient(args: string[]): Promise<void> {
  const subcommand = args[0];
  if (subcommand !== 'setup') {
    throw new Error('Usage: client setup --client cursor|gemini|claude-desktop|windsurf|opencode|zed [--scope user|project] [--force]');
  }

  const { writeClientMcpConfig, CLIENT_DEFS, VALID_CLIENT_KINDS } = await import('./client-setup.js');
  const clientFlag = readFlag(args, '--client');
  if (!clientFlag || !VALID_CLIENT_KINDS.includes(clientFlag as (typeof VALID_CLIENT_KINDS)[number])) {
    throw new Error(`Usage: client setup --client ${VALID_CLIENT_KINDS.join('|')}`);
  }

  const scopeFlag = readFlag(args, '--scope') ?? 'user';
  if (scopeFlag !== 'user' && scopeFlag !== 'project') {
    throw new Error('--scope must be user or project');
  }

  const def = CLIENT_DEFS[clientFlag as keyof typeof CLIENT_DEFS];
  if (!def.supportsProjectScope && scopeFlag === 'project') {
    logger.warn(`${def.label} only supports user scope; falling back to user scope.`);
  }

  const force = hasFlag(args, '--force');
  const result = await writeClientMcpConfig({
    client: clientFlag as keyof typeof CLIENT_DEFS,
    scope: scopeFlag as 'user' | 'project',
    force
  });

  if (result.status === 'already-configured') {
    console.log(`plugscout already configured in ${result.configPath}`);
  } else {
    console.log(`plugscout MCP config written: ${result.configPath}`);
    printHint(`Restart ${def.label} for the change to take effect.`);
  }
}

async function handleUpgrade(args: string[]): Promise<void> {
  const subcommand = args[0] ?? 'check';

  if (subcommand === 'apply') {
    const result = await applyUpdate();
    renderApplyResult(result);
    return;
  }

  if (subcommand !== 'check') {
    throw new Error('Usage: upgrade check | upgrade apply');
  }

  const result = await checkForUpdateNow();
  renderUpgradeResult(result);
}

function renderApplyResult(result: ApplyUpdateResult): void {
  if (result.status === 'upgraded') {
    console.log(`PlugScout upgraded: v${result.fromVersion} -> v${result.toVersion}`);
    return;
  }
  if (result.status === 'already-latest') {
    console.log(`PlugScout is already up to date (v${result.currentVersion}).`);
    return;
  }
  if (result.status === 'no-release') {
    console.log('No published release found yet.');
    console.log(`Releases: ${RELEASE_DOWNLOAD_URL}`);
    return;
  }
  console.log(`Upgrade failed: ${result.detail}`);
  console.log(`Manual install: npm install -g @shnitzel/plugscout@latest`);
}

function renderUpgradeResult(result: UpdateCheckResult): void {
  if (result.status === 'no-release') {
    console.log('No published release found yet.');
    console.log(`Releases: ${RELEASE_DOWNLOAD_URL}`);
    return;
  }

  if (result.status === 'error') {
    console.log('Unable to check for updates right now.');
    console.log(`Releases: ${RELEASE_DOWNLOAD_URL}`);
    return;
  }

  if (result.status === 'up-to-date') {
    console.log(`PlugScout is up to date (v${result.currentVersion}).`);
    console.log(`Latest release: v${result.latestVersion}`);
    console.log(`Releases: ${RELEASE_DOWNLOAD_URL}`);
    return;
  }

  console.log(`New PlugScout version available: v${result.currentVersion} -> v${result.latestVersion}`);
  console.log(`Upgrade: plugscout upgrade apply   |   Download: ${RELEASE_DOWNLOAD_URL}`);
}

function sortRecommendations(recommendations: Recommendation[], sort: SortKey): Recommendation[] {
  const sorted = [...recommendations];

  if (sort === 'name') {
    sorted.sort((a, b) => a.id.localeCompare(b.id));
    return sorted;
  }

  if (sort === 'trust') {
    sorted.sort((a, b) => b.scoreBreakdown.trustScore - a.scoreBreakdown.trustScore || b.rankScore - a.rankScore);
    return sorted;
  }

  if (sort === 'risk') {
    sorted.sort((a, b) => a.riskScore - b.riskScore || b.rankScore - a.rankScore);
    return sorted;
  }

  if (sort === 'fit') {
    sorted.sort((a, b) => b.scoreBreakdown.fitScore - a.scoreBreakdown.fitScore || b.rankScore - a.rankScore);
    return sorted;
  }

  sorted.sort((a, b) => b.rankScore - a.rankScore || a.id.localeCompare(b.id));
  return sorted;
}

function sortCatalogRows<T extends { item: CatalogItem; assessment: { riskScore: number }; blocked: boolean }>(
  rows: T[],
  sort: SortKey
): T[] {
  const copy = [...rows];
  if (sort === 'name') {
    copy.sort((a, b) => a.item.id.localeCompare(b.item.id));
    return copy;
  }
  if (sort === 'risk') {
    copy.sort((a, b) => a.assessment.riskScore - b.assessment.riskScore || a.item.id.localeCompare(b.item.id));
    return copy;
  }
  if (sort === 'trust') {
    copy.sort((a, b) => b.item.maintenanceSignal + b.item.provenanceSignal - (a.item.maintenanceSignal + a.item.provenanceSignal));
    return copy;
  }
  return copy.sort((a, b) => a.item.id.localeCompare(b.item.id));
}

function renderRecommendationsTable(recommendations: Recommendation[], format: string, readable = false): void {
  if (format !== 'table') {
    console.log(renderJson(recommendations));
    return;
  }

  const rows = recommendations.map((entry) => {
    const riskLabel = `${entry.riskTier}(${entry.riskScore.toFixed(0)})`;
    return {
      id: entry.id,
      kind: entry.kind,
      provider: entry.provider,
      rank: `${entry.rankScore.toFixed(1)} ${scoreBar(entry.rankScore, 8)}`,
      trust: `${entry.scoreBreakdown.trustScore.toFixed(1)} ${scoreBar(entry.scoreBreakdown.trustScore, 8)}`,
      fit: `${entry.scoreBreakdown.fitScore.toFixed(1)}`,
      risk: colorRisk(entry.riskTier, riskLabel),
      blocked: entry.blocked ? colors.red('true') : colors.green('false')
    };
  });

  console.log(
    renderTable(
      [
        { key: 'id', header: 'ID', width: readable ? 42 : 32 },
        { key: 'kind', header: 'TYPE', width: 18 },
        { key: 'provider', header: 'PROVIDER', width: 10 },
        { key: 'rank', header: 'RANK', width: 18 },
        { key: 'trust', header: 'TRUST', width: 18 },
        { key: 'fit', header: 'FIT', width: 6 },
        { key: 'risk', header: 'RISK', width: 16 },
        { key: 'blocked', header: 'BLOCKED', width: 8 }
      ],
      rows,
      { wrap: readable }
    )
  );
}

async function exportRecommendations(
  recommendations: Recommendation[],
  exportFormat: string,
  outputPath: string
): Promise<void> {
  const headers = ['id', 'kind', 'provider', 'rankScore', 'trustScore', 'fitScore', 'riskTier', 'riskScore', 'blocked'];
  const rows = recommendations.map((entry) => [
    entry.id,
    entry.kind,
    entry.provider,
    entry.rankScore.toFixed(1),
    entry.scoreBreakdown.trustScore.toFixed(1),
    entry.scoreBreakdown.fitScore.toFixed(1),
    entry.riskTier,
    entry.riskScore.toFixed(0),
    String(entry.blocked)
  ]);

  let content: string;
  if (exportFormat === 'csv') {
    content = renderCsv(headers, rows);
  } else if (exportFormat === 'md') {
    content = renderMarkdown(headers, rows);
  } else {
    throw new Error(`Unsupported export format: ${exportFormat}. Expected csv or md.`);
  }

  await fs.writeFile(path.resolve(outputPath), content, 'utf8');
}


function printHelp(): void {
  console.log('PlugScout commands');
  console.log('');
  console.log('Start here');
  console.log('  setup [--project .]        one-step: install deps + init + sync');
  console.log('  init [--project .]');
  console.log('  doctor [--project .] [--install-deps]');
  console.log('  status [--verbose]');
  console.log('  sync [--kind skill,mcp,claude-plugin,claude-connector,copilot-extension,cursor-extension,gemini-extension] [--dry-run]');
  console.log('');
  console.log('Explore');
  console.log('  list [--kind ...] [--provider ...] [--risk-tier low|medium|high|critical] [--blocked true|false] [--search q] [--limit n] [--sort name|risk|trust] [--format json|table] [--readable] [--details]');
  console.log('  search <query>');
  console.log('  show --id <catalog-id>');
  console.log('  explain [--kind ...] [--provider ...] [--limit n] [--format json|table]');
  console.log('');
  console.log('Recommend');
  console.log('  scan [--project .] [--format table|json] [--out scan-report.json] [--llm]');
  console.log('  top [--project .] [--requirements requirements.yml] [--kind ...] [--limit n] [--llm] [--readable] [--details]');
  console.log('  recommend --project . --requirements requirements.yml --format json|table [--kind ...] [--provider ...] [--limit n] [--sort score|trust|risk|fit|name] [--only-safe] [--explain-scan] [--llm] [--export csv|md --out file] [--readable] [--details]');
  console.log('  note: top/recommend are repo-aware rankings, not global popularity charts');
  console.log('  note: review each suggestion before install; do not install blindly from rank alone');
  console.log('  note: install requires recent `show` or `assess`, unless you pass --override-review');
  console.log('');
  console.log('Install and policy');
  console.log('  assess --id <catalog-id>');
  console.log('  install --id <catalog-id> [--yes] [--override-risk] [--override-review] [--install-deps]');
  console.log('  whitelist verify');
  console.log('  quarantine apply --report <path>');
  console.log('');
  console.log('Other');
  console.log('  about');
  console.log('  web [--out .plugscout/report.html] [--kind ...] [--limit n] [--open]');
  console.log('  client setup --client cursor|gemini|claude-desktop|windsurf|opencode|zed [--scope user|project] [--force]');
  console.log('  upgrade check');
  console.log('  upgrade apply                  auto-install latest version via npm');
  console.log('  help');
  console.log('');
  console.log('Kind aliases');
  console.log('  skills -> skill');
  console.log('  mcps, servers -> mcp');
  console.log('  plugins -> claude-plugin');
  console.log('  connectors -> claude-connector');
  console.log('  extensions, copilot -> copilot-extension');
  console.log('  cursor, cursor-extensions -> cursor-extension');
  console.log('  gemini, gemini-extensions -> gemini-extension');
  console.log('');
  console.log('Examples');
  console.log('  plugscout recommend --project . --only-safe --limit 10');
  console.log('  plugscout list --kind cursor --limit 15');
  console.log('  plugscout list --kind gemini --limit 11');
  console.log('  plugscout list --kind connectors --limit 10');
  console.log('  plugscout show --id claude-connector:asana');
  console.log('  plugscout client setup --client cursor');
  console.log('  plugscout client setup --client gemini');
  console.log('  plugscout client setup --client claude-desktop');
  console.log('  plugscout client setup --client windsurf');
  console.log('  plugscout client setup --client opencode');
  console.log('  plugscout client setup --client zed');
  console.log('  plugscout sync --kind cursor-extension,gemini-extension');
  console.log('');
  console.log('Global options');
  console.log('  --no-update-check');
}

async function loadLocalCliConfig(projectRoot: string): Promise<LocalCliConfig | null> {
  const configPath = path.join(projectRoot, '.skills-mcps.json');
  try {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<LocalCliConfig>;
    if (parsed.riskPosture !== 'balanced' && parsed.riskPosture !== 'strict') {
      return null;
    }

    return {
      defaultKinds: Array.isArray(parsed.defaultKinds) ? parsed.defaultKinds : ['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension', 'cursor-extension', 'gemini-extension'],
      defaultProviders: Array.isArray(parsed.defaultProviders) ? parsed.defaultProviders : [],
      riskPosture: parsed.riskPosture,
      outputStyle: parsed.outputStyle === 'json' ? 'json' : 'rich-table',
      initializedAt: typeof parsed.initializedAt === 'string' ? parsed.initializedAt : new Date().toISOString()
    };
  } catch {
    return null;
  }
}

function formatRiskScale(policy: Awaited<ReturnType<typeof loadSecurityPolicy>>): string {
  const low = policy.thresholds.lowMax;
  const medium = policy.thresholds.mediumMax;
  const high = policy.thresholds.highMax;
  const critical = policy.thresholds.criticalMax;

  return `low 0-${low}, medium ${low + 1}-${medium}, high ${medium + 1}-${high}, critical ${high + 1}-${critical}; install blocks ${policy.installGate.blockTiers.join(', ')}`;
}

function describeRiskPosture(posture: LocalCliConfig['riskPosture']): string {
  if (posture === 'strict') {
    return 'recommend/list flows prefer safe-only results by default.';
  }

  return 'show full catalog/recommendation set, including blocked items with flags.';
}

async function promptResultBrowser(entries: Array<{id: string; name: string; url?: string}>): Promise<void> {
  if (!process.stdout.isTTY || entries.length === 0) return;

  let selected = 0;

  const ENTER = '\r';
  const CTRL_C = '';
  const Q = 'q';

  // Two-line navigator: id/name line + url line (blank if none). Always writes 2 lines so cursor math is stable.
  function renderNavigator(firstRender: boolean): void {
    if (!firstRender) {
      moveCursor(process.stdout, 0, -2);
      clearScreenDown(process.stdout);
    }
    const entry = entries[selected];
    const label = entry.name ? `${entry.id}  \x1b[90m${entry.name}\x1b[0m` : entry.id;
    process.stdout.write(`  \x1b[36m❯\x1b[0m  ${label}  \x1b[90m(${selected + 1}/${entries.length})\x1b[0m\n`);
    process.stdout.write(entry.url ? `     \x1b[90m${entry.url}\x1b[0m\n` : '\n');
  }

  // eslint-disable-next-line prefer-const
  let running = true;
  let firstLoop = true;
  while (running) {
    if (firstLoop) {
      process.stdout.write('\x1b[90m  ↑↓ navigate  ⏎ inspect  q/Esc skip\x1b[0m\n');
      firstLoop = false;
    } else {
      process.stdout.write('\x1b[90m  ↑↓ navigate  ⏎ inspect another  q/Esc done\x1b[0m\n');
    }
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    renderNavigator(true);

    const action = await new Promise<{exit: boolean; id?: string}>((resolve) => {
      let escTimer: ReturnType<typeof setTimeout> | null = null;
      let pendingEsc = false;

      function doExit(): void {
        if (escTimer) { clearTimeout(escTimer); escTimer = null; }
        process.stdin.removeListener('data', onKey);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve({exit: true});
      }

      function onKey(key: string): void {
        // Handle second byte of a split escape sequence (e.g. \x1b then [A)
        if (pendingEsc) {
          pendingEsc = false;
          if (escTimer) { clearTimeout(escTimer); escTimer = null; }
          if (key === '[A') { selected = (selected - 1 + entries.length) % entries.length; renderNavigator(false); return; }
          if (key === '[B') { selected = (selected + 1) % entries.length; renderNavigator(false); return; }
          // Standalone Esc followed by something unexpected — still exit
          doExit();
          return;
        }

        if (key === CTRL_C || key === Q) {
          doExit();
        } else if (key === '\x1b[A' || key === '\x1bOA') {
          // Single-chunk arrow up (most terminals)
          selected = (selected - 1 + entries.length) % entries.length;
          renderNavigator(false);
        } else if (key === '\x1b[B' || key === '\x1bOB') {
          // Single-chunk arrow down (most terminals)
          selected = (selected + 1) % entries.length;
          renderNavigator(false);
        } else if (key === '\x1b') {
          // Could be standalone Esc or first byte of split arrow sequence
          pendingEsc = true;
          escTimer = setTimeout(() => {
            pendingEsc = false;
            escTimer = null;
            doExit();
          }, 40);
        } else if (key === ENTER) {
          if (escTimer) { clearTimeout(escTimer); escTimer = null; }
          process.stdin.removeListener('data', onKey);
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdout.write('\n');
          resolve({exit: false, id: entries[selected].id});
        }
      }

      process.stdin.on('data', onKey);
    });

    if (action.exit) {
      running = false;
    } else if (action.id) {
      await handleShow(['--id', action.id]);
    }
  }
}

function normalizeCommand(raw: string): string | null {
  const normalized = raw.trim().toLowerCase();
  return COMMAND_ALIASES[normalized] ?? null;
}

function printUnknownCommand(command: string): void {
  console.log(`Unknown command: ${command}`);
  const suggestions = suggestClosestCommandNames(command);
  if (suggestions.length > 0) {
    console.log(`Did you mean: ${suggestions.join(', ')}`);
  }
  console.log('');
  printHelp();
}

function suggestClosestCommandNames(value: string): string[] {
  const needle = value.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return Array.from(new Set(Object.values(COMMAND_ALIASES)))
    .map((command) => ({ command, score: computeTextMatchScore(command, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.command.localeCompare(b.command))
    .slice(0, 3)
    .map((entry) => entry.command);
}

async function buildCatalogItemNotFoundMessage(id: string): Promise<string> {
  const items = await loadCatalogItems();
  const suggestions = suggestCatalogItems(items, id);
  if (suggestions.length === 0) {
    return `Catalog item not found: ${id}. Try \`plugscout search ${id}\` or \`plugscout list --kind connectors\`.`;
  }

  return `Catalog item not found: ${id}. Similar IDs: ${suggestions.join(', ')}.`;
}

function suggestCatalogItems(items: CatalogItem[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }

  return items
    .map((item) => ({ id: item.id, score: computeCatalogSuggestionScore(item, needle) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, 4)
    .map((entry) => entry.id);
}

function computeCatalogSuggestionScore(item: CatalogItem, query: string): number {
  const id = item.id.toLowerCase();
  const name = item.name.toLowerCase();
  const suffix = id.includes(':') ? id.split(':').slice(1).join(':') : id;
  let score = 0;

  if (id === query) {
    return 1000;
  }
  if (suffix === query) {
    score += 300;
  }
  if (id.startsWith(query)) {
    score += 200;
  }
  if (id.includes(query)) {
    score += 120;
  }
  if (name.includes(query)) {
    score += 90;
  }
  if (query.includes(':') && suffix.includes(query.split(':').slice(1).join(':'))) {
    score += 60;
  }

  return score;
}

function computeTextMatchScore(candidate: string, query: string): number {
  const value = candidate.toLowerCase();
  if (value === query) {
    return 1000;
  }
  if (value.startsWith(query)) {
    return 200;
  }
  if (value.includes(query) || query.includes(value)) {
    return 120;
  }
  const sharedPrefix = longestSharedPrefixLength(value, query);
  if (sharedPrefix >= 2) {
    return sharedPrefix * 20;
  }
  return 0;
}

function longestSharedPrefixLength(left: string, right: string): number {
  const max = Math.min(left.length, right.length);
  let index = 0;
  while (index < max && left[index] === right[index]) {
    index += 1;
  }
  return index;
}

function renderCatalogDecisionDetails(
  rows: Array<{
    item: CatalogItem;
    assessment: Awaited<ReturnType<typeof assessRisk>>;
    blocked: boolean;
  }>,
  policy: Awaited<ReturnType<typeof loadSecurityPolicy>>,
  insights: Map<string, Awaited<ReturnType<typeof loadItemInsights>> extends Map<string, infer V> ? V : never>
): string {
  if (rows.length === 0) {
    return '\nDecision details\n- none';
  }

  const lines: string[] = ['', 'Decision details'];
  rows.forEach((entry, index) => {
    const trust = computeTrustSignal(entry.item);
    const insight = insights.get(entry.item.id);
    const status = entry.blocked ? 'blocked' : 'allowed';
    const bestFor = insight?.bestFor.length ? insight.bestFor.join('; ') : 'n/a';
    const tradeoffs = insight?.tradeoffs.length ? insight.tradeoffs.join('; ') : 'n/a';
    lines.push(
      `${index + 1}. ${entry.item.id} | ${entry.item.name}`
    );
    lines.push(
      `   Decision: trust ${trust.toFixed(1)}/100 (${describeTrustBand(trust)}), risk ${entry.assessment.riskScore.toFixed(0)}/100 (${entry.assessment.riskTier}; ${describeRiskBand(entry.assessment.riskScore, policy)}), status ${status}.`
    );
    lines.push(`   Why use: ${entry.item.description}`);
    lines.push(`   Capabilities: ${entry.item.capabilities.join(', ') || 'none'}`);
    lines.push(
      `   Provenance: provider=${entry.item.provider}, source=${entry.item.source}, confidence=${getSourceConfidence(entry.item)}, catalogType=${getCatalogType(entry.item)}.`
    );
    lines.push(`   Risk reasons: ${entry.assessment.reasons.join('; ')}`);
    lines.push(`   Best for: ${bestFor}`);
    lines.push(`   Tradeoffs: ${tradeoffs}`);
    lines.push(`   Install: plugscout install --id ${entry.item.id} --yes`);
  });

  return lines.join('\n');
}

function renderRecommendationDecisionDetails(
  recommendations: Recommendation[],
  catalogMap: Map<string, CatalogItem>,
  policy: Awaited<ReturnType<typeof loadSecurityPolicy>>,
  insights: Map<string, Awaited<ReturnType<typeof loadItemInsights>> extends Map<string, infer V> ? V : never>
): string {
  if (recommendations.length === 0) {
    return '\nRecommendation details\n- none';
  }

  const lines: string[] = ['', 'Recommendation details'];
  recommendations.forEach((entry, index) => {
    const item = catalogMap.get(entry.id);
    const insight = insights.get(entry.id);
    const blockNote = entry.blocked ? entry.blockReason ?? 'Blocked by policy' : 'Not blocked by policy';
    lines.push(`${index + 1}. ${entry.id}`);
    lines.push(
      `   Score: ${entry.rankScore.toFixed(1)} = fit ${entry.scoreBreakdown.fitScore.toFixed(1)} + trust ${entry.scoreBreakdown.trustScore.toFixed(1)} + freshness ${entry.scoreBreakdown.freshnessBonus.toFixed(1)} - security ${entry.scoreBreakdown.securityPenalty.toFixed(1)} - blocked ${entry.scoreBreakdown.blockedPenalty.toFixed(1)}`
    );
    lines.push(
      `   Risk: ${entry.riskScore.toFixed(0)}/100 (${entry.riskTier}; ${describeRiskBand(entry.riskScore, policy)}), ${blockNote}.`
    );
    lines.push(`   Why ranked: ${entry.fitReasons.slice(0, 4).join(' | ')}`);
    if (item) {
      lines.push(`   Why use: ${item.description}`);
      lines.push(`   Capabilities: ${item.capabilities.join(', ') || 'none'}`);
      lines.push(
        `   Provenance: provider=${item.provider}, source=${item.source}, confidence=${getSourceConfidence(item)}, catalogType=${getCatalogType(item)}.`
      );
    }
    if (insight?.tradeoffs.length) {
      lines.push(`   Tradeoffs: ${insight.tradeoffs.join('; ')}`);
    }
    lines.push(`   Install: plugscout install --id ${entry.id} --yes`);
  });

  return lines.join('\n');
}

function computeTrustSignal(item: CatalogItem): number {
  return (item.maintenanceSignal + item.provenanceSignal + item.adoptionSignal) / 3;
}

function describeTrustBand(score: number): string {
  if (score >= 80) {
    return 'high confidence';
  }
  if (score >= 60) {
    return 'moderate confidence';
  }
  return 'needs manual review';
}

function describeRiskBand(
  score: number,
  policy: Awaited<ReturnType<typeof loadSecurityPolicy>>
): string {
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

async function openInBrowser(filePath: string): Promise<boolean> {
  const resolved = path.resolve(filePath);
  const target = `file://${resolved}`;

  // Use a strict allowlist of platform → opener so the binary is never derived from
  // arbitrary input (suppresses js/shell-command-injection-from-environment).
  const OPENERS: Record<string, { bin: string; baseArgs: string[] }> = {
    darwin: { bin: 'open', baseArgs: [] },
    win32: { bin: 'cmd', baseArgs: ['/c', 'start', ''] },
  };
  const opener = OPENERS[process.platform] ?? { bin: 'xdg-open', baseArgs: [] };

  try {
    const child = spawn(opener.bin, [...opener.baseArgs, target], { detached: true, stdio: 'ignore' });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

function getItemMetadata(item: CatalogItem): Record<string, unknown> {
  if (!item.metadata || typeof item.metadata !== 'object' || Array.isArray(item.metadata)) {
    return {};
  }
  return item.metadata as Record<string, unknown>;
}

function getCatalogType(item: CatalogItem): string {
  const metadata = getItemMetadata(item);
  const value = metadata.catalogType;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return 'standard';
}

function getSourceConfidence(item: CatalogItem): string {
  const metadata = getItemMetadata(item);
  const value = metadata.sourceConfidence;
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  return 'official';
}

function buildItemLinks(item: CatalogItem): Array<{label: string; url: string}> {
  const meta = getItemMetadata(item);
  const links: Array<{label: string; url: string}> = [];
  const seen = new Set<string>();

  function add(label: string, url: unknown): void {
    if (typeof url !== 'string' || !url.startsWith('http')) return;
    if (seen.has(url)) return;
    seen.add(url);
    links.push({ label, url });
  }

  // Kind-specific derived URLs first (most useful)
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

  // install.url is the most direct link for the user
  add('Install page', (item.install as Record<string, unknown>).url);

  // Metadata links — priority order
  add('Repository', meta.repositoryUrl);
  add('Repository', meta.githubUrl);
  add('Repository', meta.sourceRepo?.toString().startsWith('http') ? meta.sourceRepo : undefined);
  add('Website', meta.websiteUrl);
  add('Source page', meta.sourcePage);

  // GitHub shorthand (e.g. "github/awesome-copilot") → full URL
  if (typeof meta.sourceRepo === 'string' && !meta.sourceRepo.startsWith('http')) {
    const ghUrl = `https://github.com/${meta.sourceRepo}`;
    add('Repository', ghUrl);
  }

  return links;
}
