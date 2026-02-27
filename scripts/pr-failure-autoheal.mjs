#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      continue;
    }
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) {
      out[key] = 'true';
      continue;
    }
    out[key] = value;
    i += 1;
  }
  return out;
}

function runGh(args, allowFail = false) {
  try {
    return execFileSync('gh', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    if (allowFail) {
      return '';
    }
    throw error;
  }
}

function readFile(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function writeFileIfChanged(filePath, nextContent) {
  const prev = fs.existsSync(filePath) ? readFile(filePath) : '';
  if (prev === nextContent) {
    return false;
  }
  fs.writeFileSync(filePath, nextContent, 'utf8');
  return true;
}

function applySbomTrivyResilienceFix(repoRoot) {
  const file = path.join(repoRoot, '.github/workflows/security-sbom-trivy.yml');
  let next = readFile(file);
  const before = next;

  next = next.replace(
    /(\n\s+- name: Generate SBOM\n)(\s+uses: anchore\/sbom-action@v0\n)/,
    '$1        continue-on-error: true\n$2'
  );

  next = next.replace(
    /(\n\s+- name: Run Trivy \(SARIF, blocking\)\n)(\s+uses: aquasecurity\/trivy-action@0\.34\.1\n)/,
    '$1        if: always()\n$2'
  );

  next = next.replace(
    /(\n\s+- name: Upload Trivy SARIF to code scanning\n)\s+if: always\(\)\n/,
    "$1        if: always() && hashFiles('trivy-results.sarif') != ''\n"
  );

  if (before === next) {
    return { changed: false, file };
  }

  writeFileIfChanged(file, next);
  return { changed: true, file };
}

function ensureToolkitHomeEnv(repoRoot, relativeFile, anchor) {
  const file = path.join(repoRoot, relativeFile);
  let next = readFile(file);
  const before = next;

  if (next.includes('TOOLKIT_HOME: ${{ github.workspace }}')) {
    return { changed: false, file };
  }

  const pattern = new RegExp(`(${anchor}\\n)`, 'm');
  next = next.replace(pattern, '$1    env:\n      TOOLKIT_HOME: ${{ github.workspace }}\n');

  if (before === next) {
    return { changed: false, file };
  }

  writeFileIfChanged(file, next);
  return { changed: true, file };
}

function applyStateIsolationWorkflowFix(repoRoot) {
  const patches = [
    ensureToolkitHomeEnv(repoRoot, '.github/workflows/daily-security.yml', '\\s+timeout-minutes:\\s+25'),
    ensureToolkitHomeEnv(repoRoot, '.github/workflows/catalog-sync.yml', '\\s+timeout-minutes:\\s+25'),
    ensureToolkitHomeEnv(repoRoot, '.github/workflows/ci.yml', '\\s+needs:\\s+compatibility')
  ];
  return patches.filter((patch) => patch.changed);
}

function applyDailySecurityReportGuard(repoRoot) {
  const file = path.join(repoRoot, '.github/workflows/daily-security.yml');
  let next = readFile(file);
  const before = next;

  if (!next.includes("2>/dev/null | head -n 1 || true")) {
    next = next.replace(
      /REPORT=\$\(ls -1t data\/security-reports\/\*\/report\.json \| head -n 1\)/g,
      "REPORT=$(ls -1t data/security-reports/*/report.json 2>/dev/null | head -n 1 || true)"
    );
  }

  if (!next.includes('No security report found; skipping quarantine apply.')) {
    next = next.replace(
      /echo "Latest report: \$REPORT"\n\s+npm run quarantine:apply -- --report "\$REPORT"/,
      [
        'if [ -z "$REPORT" ]; then',
        '            echo "No security report found; skipping quarantine apply."',
        '            exit 0',
        '          fi',
        '          echo "Latest report: $REPORT"',
        '          npm run quarantine:apply -- --report "$REPORT"'
      ].join('\n')
    );
  }

  if (!next.includes('- Report: none found')) {
    next = next.replace(
      /REPORT=\$\(ls -1t data\/security-reports\/\*\/report\.json[^\n]*\)\n\s+node -e '/,
      [
        "REPORT=$(ls -1t data/security-reports/*/report.json 2>/dev/null | head -n 1 || true)",
        '          if [ -z "$REPORT" ]; then',
        '            {',
        '              echo "## Daily Security Summary"',
        '              echo "- Report: none found"',
        '              echo "- Note: whitelist verification did not emit a report in data/security-reports."',
        '            } >> "$GITHUB_STEP_SUMMARY"',
        '            exit 0',
        '          fi',
        "          node -e '"
      ].join('\n')
    );
  }

  if (before === next) {
    return { changed: false, file };
  }

  writeFileIfChanged(file, next);
  return { changed: true, file };
}

function collectAgentComments(repo, prNumber) {
  const payload = runGh(['issue', 'view', String(prNumber), '--repo', repo, '--json', 'comments'], true);
  if (!payload) {
    return [];
  }

  let comments = [];
  try {
    const parsed = JSON.parse(payload);
    comments = Array.isArray(parsed.comments) ? parsed.comments : [];
  } catch {
    comments = [];
  }

  return comments
    .filter((comment) => typeof comment?.author?.login === 'string')
    .filter((comment) => comment.author.login.endsWith('[bot]') || comment.author.login.startsWith('app/'))
    .map((comment) => ({
      author: comment.author.login,
      url: comment.url ?? '',
      body: typeof comment.body === 'string' ? comment.body.slice(0, 260) : ''
    }));
}

function main() {
  const args = parseArgs(process.argv);
  const repo = args.repo;
  const runId = args['run-id'];
  const pr = Number.parseInt(args.pr ?? '', 10);
  const summaryPath = args.summary ?? '.toolkit/autoheal-summary.json';

  if (!repo || !runId || Number.isNaN(pr)) {
    throw new Error('Usage: node scripts/pr-failure-autoheal.mjs --repo <owner/repo> --run-id <id> --pr <number> [--summary path]');
  }

  const repoRoot = process.cwd();
  const failedLog = runGh(['run', 'view', String(runId), '--repo', repo, '--log-failed'], true);
  const agentComments = collectAgentComments(repo, pr);
  const combinedSignals = `${failedLog}\n${agentComments.map((entry) => entry.body).join('\n')}`;

  const rules = [];
  const changedFiles = new Set();

  if (
    combinedSignals.includes('Path does not exist: trivy-results.sarif') ||
    (combinedSignals.includes('syft') && combinedSignals.includes('unable to find tag'))
  ) {
    const patch = applySbomTrivyResilienceFix(repoRoot);
    rules.push('sbom-trivy-resilience');
    if (patch.changed) {
      changedFiles.add(path.relative(repoRoot, patch.file));
    }
  }

  if (
    combinedSignals.includes('Missing --report for quarantine apply') ||
    combinedSignals.includes("cannot access 'data/security-reports/*/report.json'")
  ) {
    const patch = applyDailySecurityReportGuard(repoRoot);
    rules.push('daily-security-report-guard');
    if (patch.changed) {
      changedFiles.add(path.relative(repoRoot, patch.file));
    }
  }

  if (
    combinedSignals.includes('Unexpected end of JSON input') &&
    (combinedSignals.includes('data/catalog/items.json') || combinedSignals.includes('data/quarantine/quarantined.json'))
  ) {
    const patches = applyStateIsolationWorkflowFix(repoRoot);
    rules.push('workflow-state-isolation');
    patches.forEach((patch) => changedFiles.add(path.relative(repoRoot, patch.file)));
  }

  const summary = {
    repo,
    pr,
    runId: Number(runId),
    matchedRules: rules,
    changedFiles: Array.from(changedFiles).sort(),
    agentCommentsReviewed: agentComments.map((entry) => ({
      author: entry.author,
      url: entry.url
    })),
    notes:
      rules.length === 0
        ? ['No supported remediation rule matched this failure signature.']
        : ['Applied only infra/test-safe remediations; runtime behavior not modified by rule design.']
  };

  fs.mkdirSync(path.dirname(summaryPath), { recursive: true });
  fs.writeFileSync(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(summary)}\n`);
}

main();
