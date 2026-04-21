import type { WorkspaceAdaptor, WorkspaceInfo, SeqeraPluginConfig, StudioWorkspaceExtra, WorkspaceTargetValue } from '../types.js'
import type { GitMetadata } from '../git.js'
import type { SeqeraClient } from '../seqera/client.js'
import type { CreateStudioRequest, CreateStudioResponse, DescribeStudioResponse } from '../seqera/studios.js'
import { readGitMetadata as defaultReadGitMetadata, buildWorkspaceName } from '../git.js'
import { createSeqeraClient } from '../seqera/client.js'
import {
  createStudio as defaultCreateStudio,
  describeStudio as defaultDescribeStudio,
  deleteStudio as defaultDeleteStudio,
} from '../seqera/studios.js'
import { mintStudioAuthHeaders } from '../seqera/studio-auth.js'
import { buildStudioBootstrapEnvironment, buildStudioWorkspaceExtra } from '../bootstrap/env.js'

export interface StudioAdaptorDeps {
  readGitMetadata(cwd?: string): Promise<GitMetadata>
  createStudio(client: SeqeraClient, workspaceId: number, body: CreateStudioRequest): Promise<CreateStudioResponse>
  describeStudio(client: SeqeraClient, workspaceId: number, sessionId: string): Promise<DescribeStudioResponse>
  deleteStudio(client: SeqeraClient, workspaceId: number, sessionId: string): Promise<void>
  resolveTargetHeaders?(studioUrl: string): Promise<Record<string, string> | undefined>
  sleep(ms: number): Promise<void>
}

const defaultDeps: StudioAdaptorDeps = {
  readGitMetadata: defaultReadGitMetadata,
  createStudio: defaultCreateStudio,
  describeStudio: defaultDescribeStudio,
  deleteStudio: defaultDeleteStudio,
  sleep: (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}

function getExtra(info: WorkspaceInfo): StudioWorkspaceExtra {
  return info.extra as StudioWorkspaceExtra
}

function deriveAuthorizeOrigins(apiBaseUrl: string): string[] {
  const apiUrl = new URL(apiBaseUrl)
  const origins = new Set<string>([apiUrl.origin])
  if (apiUrl.hostname.startsWith('api.')) {
    const uiUrl = new URL(apiUrl.toString())
    uiUrl.hostname = uiUrl.hostname.slice(4)
    origins.add(uiUrl.origin)
  }
  return Array.from(origins)
}

export function createStudioAdaptor(config: SeqeraPluginConfig, deps: StudioAdaptorDeps = defaultDeps): WorkspaceAdaptor {
  const client = createSeqeraClient(config)
  const resolveTargetHeaders = deps.resolveTargetHeaders ?? (async (studioUrl: string) =>
    mintStudioAuthHeaders({
      studioUrl,
      apiToken: config.apiToken,
      allowedAuthorizeOrigins: deriveAuthorizeOrigins(config.apiBaseUrl),
    }))

  return {
    name: 'Seqera Studio',
    description: 'Provision a Seqera Platform Studio-backed OpenCode workspace',

    async configure(info: WorkspaceInfo): Promise<WorkspaceInfo> {
      const git = await deps.readGitMetadata(info.directory ?? undefined)

      if (git.dirty) {
        throw new Error('Working tree has uncommitted changes — commit or stash before creating a workspace')
      }

      const name = buildWorkspaceName(git.repository, git.branch, git.commitSha)

      const extra = buildStudioWorkspaceExtra({
        workspaceId: config.workspaceId,
        computeEnvId: config.computeEnvId,
        studioUrl: null,
        repository: git.repository,
        revision: git.branch,
        commitId: git.commitSha,
        branch: git.branch,
        imageOrToolUrl: config.dataStudioToolUrl,
        spot: config.defaultSpot,
        requestedAt: new Date().toISOString(),
        lastKnownStatus: null,
      })

      return { ...info, name, extra }
    },

    async create(info: WorkspaceInfo, env: Record<string, string | undefined>): Promise<void> {
      const extra = getExtra(info)

      const bootstrapEnv = buildStudioBootstrapEnvironment({
        runtimeEnv: env,
        workspaceId: info.id,
        projectId: info.projectID,
        repository: extra.repository,
        commitId: extra.commitId,
        branch: extra.branch,
      })

      const body: CreateStudioRequest = {
        name: info.name,
        computeEnvId: extra.computeEnvId,
        dataStudioToolUrl: extra.imageOrToolUrl,
        configuration: {
          environment: bootstrapEnv,
          cpu: config.defaultCpu,
          memory: config.defaultMemoryMb,
          lifespanHours: config.defaultLifespanHours,
        },
        spot: extra.spot,
        remoteConfig: {
          repository: extra.repository,
          revision: extra.revision,
          commitId: extra.commitId,
        },
      }

      const { sessionId } = await deps.createStudio(client, config.workspaceId, body)
      extra.sessionId = sessionId

      const deadline = Date.now() + config.studioPollTimeoutMs
      let lastReadinessError: Error | undefined
      while (Date.now() < deadline) {
        const status = await deps.describeStudio(client, config.workspaceId, sessionId)
        if (status.studioUrl) {
          extra.studioUrl = status.studioUrl
          extra.lastKnownStatus = 'RUNNING'
          try {
            await resolveTargetHeaders(status.studioUrl)
            return
          } catch (error) {
            lastReadinessError = error instanceof Error ? error : new Error(String(error))
          }
        }
        await deps.sleep(config.studioPollIntervalMs)
      }

      const suffix = lastReadinessError ? ` — ${lastReadinessError.message}` : ''
      throw new Error(`Studio ${sessionId} timed out waiting for readiness${suffix}`)
    },

    async remove(info: WorkspaceInfo): Promise<void> {
      const extra = getExtra(info)
      if (extra.sessionId) {
        await deps.deleteStudio(client, config.workspaceId, extra.sessionId)
      }
    },

    async target(info: WorkspaceInfo): Promise<WorkspaceTargetValue> {
      const extra = getExtra(info)
      if (!extra.studioUrl) {
        throw new Error('No studio URL available — workspace may not be running')
      }
      const headers = await resolveTargetHeaders(extra.studioUrl)
      return headers
        ? { type: 'remote', url: extra.studioUrl, headers }
        : { type: 'remote', url: extra.studioUrl }
    },
  }
}
