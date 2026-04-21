import type { SeqeraPluginConfig } from '../types.js'

const DEFAULT_CONFIG: SeqeraPluginConfig = {
  apiBaseUrl: 'https://api.cloud.seqera.io',
  apiToken: '',
  workspaceId: 0,
  computeEnvId: '',
  dataStudioToolUrl: '',
  defaultCpu: 4,
  defaultMemoryMb: 16384,
  defaultLifespanHours: 8,
  defaultSpot: true,
  studioPollTimeoutMs: 10 * 60 * 1000,
  studioPollIntervalMs: 5 * 1000,
}

function readEnvNumber(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>
}

export function loadSeqeraPluginConfig(overrides: Partial<SeqeraPluginConfig> = {}): SeqeraPluginConfig {
  const env = process.env
  const defined = stripUndefined(overrides)

  return {
    ...DEFAULT_CONFIG,
    apiBaseUrl: env.SEQERA_API_BASE_URL ?? DEFAULT_CONFIG.apiBaseUrl,
    apiToken: env.SEQERA_API_TOKEN ?? DEFAULT_CONFIG.apiToken,
    workspaceId: readEnvNumber(env.SEQERA_WORKSPACE_ID, DEFAULT_CONFIG.workspaceId),
    computeEnvId: env.SEQERA_COMPUTE_ENV_ID ?? DEFAULT_CONFIG.computeEnvId,
    dataStudioToolUrl: env.SEQERA_DATA_STUDIO_TOOL_URL ?? DEFAULT_CONFIG.dataStudioToolUrl,
    defaultCpu: readEnvNumber(env.SEQERA_DEFAULT_CPU, DEFAULT_CONFIG.defaultCpu),
    defaultMemoryMb: readEnvNumber(env.SEQERA_DEFAULT_MEMORY_MB, DEFAULT_CONFIG.defaultMemoryMb),
    defaultLifespanHours: readEnvNumber(env.SEQERA_DEFAULT_LIFESPAN_HOURS, DEFAULT_CONFIG.defaultLifespanHours),
    defaultSpot: env.SEQERA_DEFAULT_SPOT ? env.SEQERA_DEFAULT_SPOT !== 'false' : DEFAULT_CONFIG.defaultSpot,
    studioPollTimeoutMs: readEnvNumber(env.SEQERA_STUDIO_POLL_TIMEOUT_MS, DEFAULT_CONFIG.studioPollTimeoutMs),
    studioPollIntervalMs: readEnvNumber(env.SEQERA_STUDIO_POLL_INTERVAL_MS, DEFAULT_CONFIG.studioPollIntervalMs),
    ...defined,
  }
}
