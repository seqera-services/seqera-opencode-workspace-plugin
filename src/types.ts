export interface SeqeraPluginConfig {
  apiBaseUrl: string
  apiToken: string
  workspaceId: number
  computeEnvId: string
  dataStudioToolUrl: string
  defaultCpu: number
  defaultMemoryMb: number
  defaultLifespanHours: number
  defaultSpot: boolean
  studioPollTimeoutMs: number
  studioPollIntervalMs: number
}

export interface StudioWorkspaceExtra {
  backend: 'studio'
  sessionId: string | null
  workspaceId: number
  computeEnvId: string
  studioUrl: string | null
  repository: string
  revision: string | null
  commitId: string
  branch: string | null
  imageOrToolUrl: string
  spot: boolean
  requestedAt: string
  lastKnownStatus: string | null
}

export interface WorkspaceInfo {
  id: string
  type: string
  name: string
  branch: string | null
  directory: string | null
  extra: unknown | null
  projectID: string
}

export interface WorkspaceTargetLocal {
  type: 'local'
  directory: string
}

export interface WorkspaceTargetRemote {
  type: 'remote'
  url: string | URL
  headers?: Record<string, string>
}

export type WorkspaceTargetValue = WorkspaceTargetLocal | WorkspaceTargetRemote

export interface WorkspaceAdaptor {
  name: string
  description: string
  configure(info: WorkspaceInfo): WorkspaceInfo | Promise<WorkspaceInfo>
  create(info: WorkspaceInfo, env: Record<string, string | undefined>, from?: WorkspaceInfo): Promise<void>
  remove(info: WorkspaceInfo): Promise<void>
  target(info: WorkspaceInfo): WorkspaceTargetValue | Promise<WorkspaceTargetValue>
}

export interface PluginInput {
  experimental_workspace: {
    register(type: string, adaptor: WorkspaceAdaptor): void
  }
  project: {
    id: string
    name?: string
  }
  directory: string
  worktree: string
  serverUrl?: URL
}

export type Plugin = (
  input: PluginInput,
  options?: Partial<SeqeraPluginConfig>,
) => Promise<Record<string, never>>
