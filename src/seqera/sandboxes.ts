export interface SandboxCreateRequest {
  image?: string
  region?: string
  timeoutMinutes?: number
  envVars?: Record<string, string>
  provider?: string
  workspaceId?: number
  computeEnvId?: string
  workDir?: string
}

export interface SandboxCreateResponse {
  sandboxId: string
}

export async function createSandbox(): Promise<SandboxCreateResponse> {
  throw new Error('Scheduler sandboxes are not part of the V1 scaffold yet')
}
