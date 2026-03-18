import fs from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { getPackagePath } from '../../src/lib/paths.js';
import { RegistriesFileSchema } from '../../src/lib/validation/contracts.js';

describe('registry configuration', () => {
  it('uses supported plugin sources and removes dead plugin APIs', async () => {
    const raw = await fs.readFile(getPackagePath('config/registries.json'), 'utf8');
    const parsed = RegistriesFileSchema.parse(JSON.parse(raw));
    const byId = new Map(parsed.registries.map((registry) => [registry.id, registry]));

    expect(byId.has('github-copilot-plugins-official')).toBe(true);
    expect(byId.has('github-awesome-copilot-marketplace')).toBe(true);
    expect(byId.has('anthropic-claude-connectors-scrape')).toBe(true);
    expect(byId.has('official-claude-plugins')).toBe(true);
    expect(byId.has('anthropic-claude-plugins-official-github')).toBe(true);
    expect(byId.has('anthropic-knowledge-work-plugins')).toBe(true);
    expect(byId.has('anthropic-financial-services-plugins')).toBe(true);
    expect(byId.has('anthropic-skills')).toBe(true);
    expect(byId.has('github-n-skills-marketplace')).toBe(true);
    expect(byId.has('trailofbits-skills-marketplace')).toBe(true);
    expect(byId.has('github-mhattingpete-claude-skills')).toBe(true);
    expect(byId.has('github-neon-ai-rules')).toBe(true);
    expect(byId.has('github-curated-industry-skills')).toBe(true);
    expect(byId.has('github-docker-claude-plugins')).toBe(true);
    expect(byId.has('github-pleaseai-claude-code-plugins')).toBe(true);

    expect(byId.get('official-copilot-extensions')?.remote).toBeUndefined();
    expect(byId.get('official-claude-plugins')?.remote?.url).toBe('https://claude.com/plugins');
    expect(byId.get('official-claude-plugins')?.adapter).toBe('claude-plugins-scrape-v1');
    expect(byId.get('anthropic-claude-connectors-scrape')?.kind).toBe('claude-connector');

    expect(byId.get('github-copilot-plugins-official')?.remote?.url).toContain(
      'raw.githubusercontent.com/github/copilot-plugins'
    );
    expect(byId.get('github-awesome-copilot-marketplace')?.remote?.url).toContain(
      'raw.githubusercontent.com/github/awesome-copilot'
    );
    expect(byId.get('anthropic-claude-connectors-scrape')?.remote?.url).toBe(
      'https://claude.com/connectors'
    );
    expect(byId.get('anthropic-claude-plugins-official-github')?.remote?.url).toContain(
      'raw.githubusercontent.com/anthropics/claude-plugins-official'
    );
    expect(byId.get('anthropic-knowledge-work-plugins')?.remote?.url).toContain(
      'raw.githubusercontent.com/anthropics/knowledge-work-plugins'
    );
    expect(byId.get('anthropic-skills')?.remote?.url).toContain(
      'raw.githubusercontent.com/anthropics/skills'
    );
    expect(byId.get('github-n-skills-marketplace')?.remote?.url).toContain(
      'raw.githubusercontent.com/numman-ali/n-skills'
    );
    expect(byId.get('trailofbits-skills-marketplace')?.remote?.url).toContain(
      'raw.githubusercontent.com/trailofbits/skills'
    );
    expect(byId.get('github-docker-claude-plugins')?.remote?.url).toContain(
      'raw.githubusercontent.com/docker/claude-plugins'
    );
  });
});
