import { z } from 'zod';

const isoDate = z
  .string()
  .regex(/^(19|20|21)\d{2}-[01]\d-[0-3]\d$/, 'Expected ISO date (YYYY-MM-DD)');

export const RiskTierSchema = z.enum(['low', 'medium', 'high', 'critical']);
export const CatalogKindSchema = z.enum(['skill', 'mcp', 'claude-plugin', 'claude-connector', 'copilot-extension']);

const SecuritySignalsSchema = z
  .object({
    knownVulnerabilities: z.number().int().min(0).default(0),
    suspiciousPatterns: z.number().int().min(0).default(0),
    injectionFindings: z.number().int().min(0).default(0),
    exfiltrationSignals: z.number().int().min(0).default(0),
    integrityAlerts: z.number().int().min(0).default(0)
  })
  .default({});

export const InstallMethodSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('skill.sh'),
    target: z.string().min(1),
    args: z.array(z.string()).default([])
  }),
  z.object({
    kind: z.literal('gh-cli'),
    target: z.string().min(1),
    args: z.array(z.string()).default([])
  }),
  z.object({
    kind: z.literal('manual'),
    instructions: z.string().min(1),
    url: z.string().url().optional()
  })
]);

export const CatalogItemSchema = z.object({
  id: z.string().min(1),
  kind: CatalogKindSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  provider: z.string().min(1),
  capabilities: z.array(z.string().min(1)).default([]),
  compatibility: z.array(z.string().min(1)).default([]),
  source: z.string().min(1),
  lastSeenAt: isoDate,
  transport: z.enum(['stdio', 'http', 'sse', 'websocket']).optional(),
  authModel: z.enum(['none', 'api_key', 'oauth', 'custom']).optional(),
  install: InstallMethodSchema,
  adoptionSignal: z.number().min(0).max(100).default(50),
  maintenanceSignal: z.number().min(0).max(100).default(50),
  provenanceSignal: z.number().min(0).max(100).default(80),
  freshnessSignal: z.number().min(0).max(100).default(50),
  securitySignals: SecuritySignalsSchema,
  metadata: z.record(z.unknown()).default({})
});

export const CatalogSkillSchema = CatalogItemSchema.extend({
  kind: z.literal('skill')
});

export const CatalogMcpServerSchema = CatalogItemSchema.extend({
  kind: z.literal('mcp'),
  transport: z.enum(['stdio', 'http', 'sse', 'websocket']).default('stdio'),
  authModel: z.enum(['none', 'api_key', 'oauth', 'custom']).default('none')
});

export const RiskAssessmentSchema = z.object({
  id: z.string().min(1),
  riskScore: z.number().min(0).max(100),
  riskTier: RiskTierSchema,
  reasons: z.array(z.string().min(1)).nonempty(),
  scannerResults: z.object({
    packageIntegrity: z.object({ findings: z.number().int().min(0) }),
    vulnerabilityIntel: z.object({ findings: z.number().int().min(0) }),
    permissionPatterns: z.object({ findings: z.number().int().min(0) }),
    injectionTests: z.object({ findings: z.number().int().min(0) }),
    exfiltrationHeuristics: z.object({ findings: z.number().int().min(0) })
  }),
  assessedAt: z.string().datetime()
});

export const RecommendationSchema = z.object({
  id: z.string().min(1),
  kind: CatalogKindSchema,
  provider: z.string().min(1),
  rankScore: z.number().min(0).max(100),
  fitReasons: z.array(z.string().min(1)).nonempty(),
  scoreBreakdown: z.object({
    fitScore: z.number().min(0).max(100),
    trustScore: z.number().min(0).max(100),
    securityPenalty: z.number().min(0).max(100),
    freshnessBonus: z.number().min(0).max(100),
    blockedPenalty: z.number().min(0).max(100)
  }),
  riskTier: RiskTierSchema,
  riskScore: z.number().min(0).max(100),
  blocked: z.boolean(),
  blockReason: z.string().optional(),
  installMethod: z.enum(['skill.sh', 'gh-cli', 'manual'])
});

export const InstallAuditSchema = z.object({
  id: z.string().min(1),
  requestedAt: z.string().datetime(),
  policyDecision: z.enum(['allowed', 'blocked', 'override-allowed']),
  overrideUsed: z.boolean(),
  installer: z.enum(['skill.sh', 'gh-cli', 'manual', 'skills', 'npm', 'docker']),
  exitCode: z.number().int()
});

export const RemoteRegistrySchema = z.object({
  url: z.string().url(),
  format: z.enum(['json-array', 'catalog-json', 'html']).default('json-array'),
  entryPath: z.string().min(1).optional(),
  supportsUpdatedSince: z.boolean().default(false),
  updatedSinceParam: z.string().min(1).default('updated_since'),
  pagination: z
    .object({
      mode: z.literal('cursor').default('cursor'),
      cursorParam: z.string().min(1).default('cursor'),
      nextCursorPath: z.string().min(1).default('next_cursor'),
      limitParam: z.string().min(1).optional(),
      limit: z.number().int().min(1).max(1000).optional()
    })
    .optional(),
  timeoutMs: z.number().int().min(100).max(120000).default(10000),
  authEnv: z.string().min(1).optional(),
  fallbackToLocal: z.boolean().default(true),
  provider: z.string().min(1).optional(),
  official: z.boolean().default(true),
  licenseHint: z.string().min(1).optional()
});

export const RegistrySchema = z.object({
  id: z.string().min(1),
  kind: CatalogKindSchema,
  sourceType: z.enum(['public-index', 'vendor-feed', 'community-list']),
  adapter: z
    .enum([
      'direct',
      'mcp-registry-v0.1',
      'openai-skills-v1',
      'openai-skills-github-v1',
      'claude-plugins-v0.1',
      'claude-plugins-scrape-v1',
      'claude-code-marketplace-v1',
      'copilot-extensions-v0.1',
      'copilot-plugin-marketplace-v1',
      'claude-connectors-scrape-v1'
    ])
    .default('direct'),
  enabled: z.boolean().default(true),
  officialOnly: z.boolean().default(true),
  entries: z.array(z.unknown()).default([]),
  remote: RemoteRegistrySchema.optional()
});

export const RegistriesFileSchema = z.object({
  registries: z.array(RegistrySchema)
});

export const SecurityPolicySchema = z.object({
  thresholds: z.object({
    lowMax: z.number().int().min(0).max(100).default(24),
    mediumMax: z.number().int().min(0).max(100).default(49),
    highMax: z.number().int().min(0).max(100).default(74),
    criticalMax: z.number().int().min(0).max(100).default(100)
  }),
  installGate: z.object({
    blockTiers: z.array(RiskTierSchema).default(['high', 'critical']),
    warnTiers: z.array(RiskTierSchema).default(['medium'])
  }),
  scoring: z.object({
    vulnerabilityWeight: z.number().int().min(1).default(15),
    suspiciousWeight: z.number().int().min(1).default(10),
    injectionWeight: z.number().int().min(1).default(12),
    exfiltrationWeight: z.number().int().min(1).default(12),
    integrityWeight: z.number().int().min(1).default(10)
  })
});

export const RankingPolicySchema = z.object({
  weights: z.object({
    compatibility: z.number().min(0).max(100).default(25),
    capabilityCoverage: z.number().min(0).max(100).default(20),
    maintenance: z.number().min(0).max(100).default(18),
    provenance: z.number().min(0).max(100).default(18),
    adoption: z.number().min(0).max(100).default(12),
    freshnessBonusMax: z.number().min(0).max(100).default(8),
    securityPenaltyMax: z.number().min(0).max(100).default(40),
    blockedPenalty: z.number().min(0).max(100).default(40)
  }),
  tieBreakers: z.array(z.enum(['trust', 'risk', 'name'])).default(['trust', 'risk', 'name']),
  blockedFloorTier: RiskTierSchema.default('high')
});

export const RecommendationWeightsSchema = z.object({
  compatibility: z.number().min(0).max(100).default(40),
  capabilityCoverage: z.number().min(0).max(100).default(25),
  maintenance: z.number().min(0).max(100).default(15),
  adoption: z.number().min(0).max(100).default(10),
  securityPenaltyMax: z.number().min(0).max(100).default(30)
});

export const ProviderConfigSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  officialOnly: z.boolean().default(true),
  trustLevel: z.enum(['high', 'medium', 'low']).default('high'),
  authEnv: z.string().min(1).optional(),
  poll: z.object({
    mode: z.enum(['daily', 'manual', 'every-6h']).default('daily'),
    rateLimitPerMinute: z.number().int().min(1).max(1000).default(60)
  })
});

export const ProvidersFileSchema = z.object({
  providers: z.array(ProviderConfigSchema)
});

export const ItemInsightSchema = z.object({
  id: z.string().min(1),
  benefitSummary: z.string().min(1),
  bestFor: z.array(z.string().min(1)).default([]),
  whenToUse: z.array(z.string().min(1)).default([]),
  tradeoffs: z.array(z.string().min(1)).default([]),
  usageNotes: z.array(z.string().min(1)).default([])
});

export const ItemInsightsFileSchema = z.object({
  insights: z.array(ItemInsightSchema)
});

export const RequirementsProfileSchema = z.object({
  useCase: z.string().default('general'),
  stack: z.array(z.string()).default([]),
  deployment: z.string().default('local'),
  securityPosture: z.enum(['balanced', 'strict']).default('balanced'),
  requiredCapabilities: z.array(z.string()).default([])
});

export const WhitelistFileSchema = z.object({
  approved: z.array(z.string().min(1)).default([])
});

export const QuarantineEntrySchema = z.object({
  id: z.string().min(1),
  reason: z.string().min(1),
  quarantinedAt: z.string().datetime()
});

export const QuarantineFileSchema = z.object({
  quarantined: z.array(QuarantineEntrySchema).default([])
});

export const SecurityReportSchema = z.object({
  generatedAt: z.string().datetime(),
  staleRegistries: z.array(z.string().min(1)).default([]),
  passed: z.array(z.string()).default([]),
  failed: z
    .array(
      z.object({
        id: z.string().min(1),
        riskTier: RiskTierSchema,
        riskScore: z.number().min(0).max(100),
        reasons: z.array(z.string()).nonempty()
      })
    )
    .default([])
});

export type CatalogKind = z.infer<typeof CatalogKindSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type CatalogSkill = z.infer<typeof CatalogSkillSchema>;
export type CatalogMcpServer = z.infer<typeof CatalogMcpServerSchema>;
export type RiskTier = z.infer<typeof RiskTierSchema>;
export type RiskAssessment = z.infer<typeof RiskAssessmentSchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type InstallAudit = z.infer<typeof InstallAuditSchema>;
export type Registry = z.infer<typeof RegistrySchema>;
export type RemoteRegistryConfig = z.infer<typeof RemoteRegistrySchema>;
export type SecurityPolicy = z.infer<typeof SecurityPolicySchema>;
export type RankingPolicy = z.infer<typeof RankingPolicySchema>;
export type RecommendationWeights = z.infer<typeof RecommendationWeightsSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
export type ItemInsight = z.infer<typeof ItemInsightSchema>;
export type RequirementsProfile = z.infer<typeof RequirementsProfileSchema>;
export type SecurityReport = z.infer<typeof SecurityReportSchema>;
export type QuarantineEntry = z.infer<typeof QuarantineEntrySchema>;
export type InstallMethod = z.infer<typeof InstallMethodSchema>;
