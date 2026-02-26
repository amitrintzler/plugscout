import fs from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

type WorkflowExpectation = {
  triggers: Array<'push' | 'pull_request' | 'schedule' | 'workflow_dispatch'>;
  crons?: string[];
};

const WORKFLOW_ROOT = path.resolve('.github/workflows');

const EXPECTATIONS: Record<string, WorkflowExpectation> = {
  'ci.yml': {
    triggers: ['push', 'pull_request']
  },
  'daily-security.yml': {
    triggers: ['schedule', 'workflow_dispatch'],
    crons: ['12 3 * * *']
  },
  'catalog-sync.yml': {
    triggers: ['schedule', 'workflow_dispatch'],
    crons: ['0 2 * * *']
  },
  'security-codeql.yml': {
    triggers: ['push', 'pull_request', 'schedule', 'workflow_dispatch'],
    crons: ['30 2 * * 1']
  },
  'security-dependency-review.yml': {
    triggers: ['pull_request']
  },
  'security-sbom-trivy.yml': {
    triggers: ['push', 'pull_request', 'schedule', 'workflow_dispatch'],
    crons: ['45 2 * * 1']
  },
  'security-secrets.yml': {
    triggers: ['push', 'pull_request', 'workflow_dispatch']
  }
};

function expectTrigger(raw: string, trigger: string): void {
  expect(raw).toMatch(new RegExp(`^\\s*${trigger}:`, 'm'));
}

describe('workflow trigger and schedule contracts', () => {
  for (const [file, expectation] of Object.entries(EXPECTATIONS)) {
    it(`enforces required triggers for ${file}`, async () => {
      const workflowPath = path.join(WORKFLOW_ROOT, file);
      const raw = await fs.readFile(workflowPath, 'utf8');

      expect(raw).toMatch(/^name:\s+/m);
      expect(raw).toMatch(/^on:\s*/m);

      expectation.triggers.forEach((trigger) => expectTrigger(raw, trigger));

      if (expectation.crons) {
        expectation.crons.forEach((cron) => {
          expect(raw).toContain(cron);
          expect(raw).toMatch(/^\s*-\s*cron:\s*['"][^'"]+['"]/m);
        });
      }
    });
  }
});
