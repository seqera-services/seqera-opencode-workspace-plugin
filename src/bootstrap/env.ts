import type { StudioWorkspaceExtra } from '../types.js'

export interface BootstrapEnvironmentInput {
  opencodeAuthContent: string
  workspaceId: string
  projectId: string
  repository: string
  commitId: string
  branch: string | null
}

export function buildStudioBootstrapEnvironment(input: BootstrapEnvironmentInput): Record<string, string> {
  return {
    OPENCODE_AUTH_CONTENT: input.opencodeAuthContent,
    OPENCODE_WORKSPACE_ID: input.workspaceId,
    OPENCODE_EXPERIMENTAL_WORKSPACES: 'true',
    OPENCODE_PROJECT_ID: input.projectId,
    OPENCODE_GIT_REPOSITORY: input.repository,
    OPENCODE_GIT_COMMIT: input.commitId,
    ...(input.branch ? { OPENCODE_GIT_BRANCH: input.branch } : {}),
  }
}

export function buildStudioWorkspaceExtra(input: {
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
}): StudioWorkspaceExtra {
  return {
    backend: 'studio',
    sessionId: null,
    ...input,
  }
}
