import type { SeqeraClient } from './client.js'

export interface CreateStudioRequest {
  name: string
  computeEnvId: string
  dataStudioToolUrl: string
  configuration: {
    environment: Record<string, string>
    cpu: number
    memory: number
    lifespanHours: number
  }
  spot: boolean
  remoteConfig: {
    repository: string
    revision: string | null
    commitId: string
  }
}

export interface CreateStudioResponse {
  sessionId: string
}

export interface DescribeStudioResponse {
  sessionId: string
  studioUrl?: string | null
  statusInfo?: unknown
  remoteConfig?: unknown
}

export async function createStudio(client: SeqeraClient, workspaceId: number, body: CreateStudioRequest): Promise<CreateStudioResponse> {
  return client.fetchJson<CreateStudioResponse>(`/studios?workspaceId=${workspaceId}&autoStart=true`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

export async function describeStudio(client: SeqeraClient, workspaceId: number, sessionId: string): Promise<DescribeStudioResponse> {
  return client.fetchJson<DescribeStudioResponse>(`/studios/${encodeURIComponent(sessionId)}?workspaceId=${workspaceId}`)
}

export async function deleteStudio(client: SeqeraClient, workspaceId: number, sessionId: string): Promise<void> {
  await client.fetchJson<void>(`/studios/${encodeURIComponent(sessionId)}?workspaceId=${workspaceId}`, {
    method: 'DELETE',
  })
}
