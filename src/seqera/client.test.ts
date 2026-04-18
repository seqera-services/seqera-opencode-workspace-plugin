import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSeqeraClient } from './client.ts'
import {
  createStudio,
  describeStudio,
  startStudio,
  stopStudio,
  deleteStudio,
} from './studios.ts'
import type { SeqeraPluginConfig } from '../types.ts'

const BASE_CONFIG: SeqeraPluginConfig = {
  apiBaseUrl: 'https://api.example.com',
  apiToken: 'test-token-123',
  workspaceId: 42,
  computeEnvId: 'ce-abc',
  dataStudioToolUrl: 'ghcr.io/seqeralabs/opencode-studio:latest',
  defaultCpu: 4,
  defaultMemoryMb: 16384,
  defaultLifespanHours: 8,
  defaultSpot: true,
  studioPollTimeoutMs: 600_000,
  studioPollIntervalMs: 5_000,
}

/** Build a mock fetch that returns a canned response. */
function mockFetch(
  status: number,
  body?: unknown,
  headers?: Record<string, string>,
): typeof globalThis.fetch {
  return async (_url: string | URL | Request, _init?: RequestInit) => {
    const respHeaders = new Headers({
      'content-type': 'application/json',
      ...headers,
    })
    return new Response(
      body !== undefined ? JSON.stringify(body) : null,
      { status, statusText: statusForText(status), headers: respHeaders },
    )
  }
}

function statusForText(code: number): string {
  const map: Record<number, string> = { 200: 'OK', 201: 'Created', 204: 'No Content', 400: 'Bad Request', 401: 'Unauthorized', 404: 'Not Found', 500: 'Internal Server Error' }
  return map[code] ?? 'Unknown'
}

/** Capture the request URL and init passed to fetch. */
function capturingFetch(
  status: number,
  body?: unknown,
): { fetch: typeof globalThis.fetch; captured: () => { url: string; init: RequestInit | undefined } } {
  let capturedUrl = ''
  let capturedInit: RequestInit | undefined
  const fn: typeof globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    capturedUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    capturedInit = init
    return new Response(
      body !== undefined ? JSON.stringify(body) : null,
      { status, statusText: statusForText(status) },
    )
  }
  return { fetch: fn, captured: () => ({ url: capturedUrl, init: capturedInit }) }
}

// ---------------------------------------------------------------------------
// SeqeraClient
// ---------------------------------------------------------------------------
describe('SeqeraClient', () => {
  it('sends auth header and builds correct URL', async () => {
    const { fetch: fn, captured } = capturingFetch(200, { ok: true })
    const client = createSeqeraClient(BASE_CONFIG, fn)
    await client.fetchJson('/studios?workspaceId=1')
    const { url, init } = captured()
    assert.equal(url, 'https://api.example.com/studios?workspaceId=1')
    const headers = init?.headers as Record<string, string>
    assert.equal(headers['authorization'], 'Bearer test-token-123')
  })

  it('handles base URL with trailing slash', async () => {
    const { fetch: fn, captured } = capturingFetch(200, { ok: true })
    const config = { ...BASE_CONFIG, apiBaseUrl: 'https://api.example.com/' }
    const client = createSeqeraClient(config, fn)
    await client.fetchJson('/studios')
    assert.equal(captured().url, 'https://api.example.com/studios')
  })

  it('includes response body text in error message', async () => {
    const fn: typeof globalThis.fetch = async () =>
      new Response(JSON.stringify({ message: 'workspace not found' }), {
        status: 404,
        statusText: 'Not Found',
      })
    const client = createSeqeraClient(BASE_CONFIG, fn)
    await assert.rejects(
      () => client.fetchJson('/studios/bad'),
      (err: Error) => {
        assert.match(err.message, /404/)
        assert.match(err.message, /workspace not found/)
        return true
      },
    )
  })

  it('fetchVoid resolves on 204 No Content', async () => {
    const client = createSeqeraClient(BASE_CONFIG, mockFetch(204))
    await client.fetchVoid('/studios/s1', { method: 'DELETE' })
  })

  it('fetchVoid rejects on error status', async () => {
    const client = createSeqeraClient(BASE_CONFIG, mockFetch(500, { error: 'boom' }))
    await assert.rejects(
      () => client.fetchVoid('/studios/s1/start', { method: 'PUT' }),
      (err: Error) => {
        assert.match(err.message, /500/)
        return true
      },
    )
  })
})

// ---------------------------------------------------------------------------
// Studio lifecycle
// ---------------------------------------------------------------------------
describe('createStudio', () => {
  it('POSTs to /studios with workspaceId and autoStart', async () => {
    const responseBody = { sessionId: 'sess-1' }
    const { fetch: fn, captured } = capturingFetch(200, responseBody)
    const client = createSeqeraClient(BASE_CONFIG, fn)

    const result = await createStudio(client, 42, {
      name: 'repo-main-abc1234',
      computeEnvId: 'ce-abc',
      dataStudioToolUrl: 'ghcr.io/seqeralabs/opencode-studio:latest',
      configuration: { environment: {}, cpu: 4, memory: 16384, lifespanHours: 8 },
      spot: true,
      remoteConfig: { repository: 'https://github.com/org/repo.git', revision: 'main', commitId: 'abc1234' },
    })

    assert.equal(result.sessionId, 'sess-1')
    const { url, init } = captured()
    assert.match(url, /\/studios\?workspaceId=42&autoStart=true/)
    assert.equal(init?.method, 'POST')
  })
})

describe('describeStudio', () => {
  it('GETs /studios/:sessionId with workspaceId', async () => {
    const responseBody = { sessionId: 'sess-1', studioUrl: 'https://studio.example.com', statusInfo: { status: 'RUNNING' } }
    const { fetch: fn, captured } = capturingFetch(200, responseBody)
    const client = createSeqeraClient(BASE_CONFIG, fn)

    const result = await describeStudio(client, 42, 'sess-1')
    assert.equal(result.sessionId, 'sess-1')
    assert.equal(result.studioUrl, 'https://studio.example.com')
    assert.match(captured().url, /\/studios\/sess-1\?workspaceId=42/)
  })
})

describe('startStudio', () => {
  it('PUTs to /studios/:sessionId/start', async () => {
    const { fetch: fn, captured } = capturingFetch(204)
    const client = createSeqeraClient(BASE_CONFIG, fn)

    await startStudio(client, 42, 'sess-1')
    const { url, init } = captured()
    assert.match(url, /\/studios\/sess-1\/start\?workspaceId=42/)
    assert.equal(init?.method, 'PUT')
  })
})

describe('stopStudio', () => {
  it('PUTs to /studios/:sessionId/stop', async () => {
    const { fetch: fn, captured } = capturingFetch(204)
    const client = createSeqeraClient(BASE_CONFIG, fn)

    await stopStudio(client, 42, 'sess-1')
    const { url, init } = captured()
    assert.match(url, /\/studios\/sess-1\/stop\?workspaceId=42/)
    assert.equal(init?.method, 'PUT')
  })
})

describe('deleteStudio', () => {
  it('DELETEs /studios/:sessionId with workspaceId', async () => {
    const { fetch: fn, captured } = capturingFetch(204)
    const client = createSeqeraClient(BASE_CONFIG, fn)

    await deleteStudio(client, 42, 'sess-1')
    const { url, init } = captured()
    assert.match(url, /\/studios\/sess-1\?workspaceId=42/)
    assert.equal(init?.method, 'DELETE')
  })

  it('encodes sessionId in URL', async () => {
    const { fetch: fn, captured } = capturingFetch(204)
    const client = createSeqeraClient(BASE_CONFIG, fn)

    await deleteStudio(client, 42, 'sess/special')
    assert.match(captured().url, /\/studios\/sess%2Fspecial\?workspaceId=42/)
  })
})
