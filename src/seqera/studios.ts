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

export interface ListStudiosItem {
  sessionId: string
  name?: string
  studioUrl?: string | null
  statusInfo?: unknown
}

export interface ListStudiosResponse {
  sessions: ListStudiosItem[]
}

interface ListStudiosApiResponse {
  studios?: ListStudiosItem[]
}

function studioPath(sessionId: string, suffix = ''): string {
  return `/studios/${encodeURIComponent(sessionId)}${suffix}`
}

export async function createStudio(
  client: SeqeraClient,
  workspaceId: number,
  body: CreateStudioRequest,
): Promise<CreateStudioResponse> {
  return client.fetchJson<CreateStudioResponse>(
    `/studios?workspaceId=${workspaceId}&autoStart=true`,
    { method: 'POST', body: JSON.stringify(body) },
  )
}

export async function listStudios(
  client: SeqeraClient,
  workspaceId: number,
): Promise<ListStudiosResponse> {
  const response = await client.fetchJson<ListStudiosApiResponse>(
    `/studios?workspaceId=${workspaceId}`,
  )
  return { sessions: response.studios ?? [] }
}

export async function describeStudio(
  client: SeqeraClient,
  workspaceId: number,
  sessionId: string,
): Promise<DescribeStudioResponse> {
  return client.fetchJson<DescribeStudioResponse>(
    `${studioPath(sessionId)}?workspaceId=${workspaceId}`,
  )
}

export async function startStudio(
  client: SeqeraClient,
  workspaceId: number,
  sessionId: string,
): Promise<void> {
  await client.fetchVoid(
    `${studioPath(sessionId, '/start')}?workspaceId=${workspaceId}`,
    { method: 'PUT' },
  )
}

export async function stopStudio(
  client: SeqeraClient,
  workspaceId: number,
  sessionId: string,
): Promise<void> {
  await client.fetchVoid(
    `${studioPath(sessionId, '/stop')}?workspaceId=${workspaceId}`,
    { method: 'PUT' },
  )
}

export async function deleteStudio(
  client: SeqeraClient,
  workspaceId: number,
  sessionId: string,
): Promise<void> {
  await client.fetchVoid(
    `${studioPath(sessionId)}?workspaceId=${workspaceId}`,
    { method: 'DELETE' },
  )
}
