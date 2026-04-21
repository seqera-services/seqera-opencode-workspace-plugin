import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createStudio } from './studios.ts'
import type { SeqeraClient } from './client.ts'

function fakeClient(responseBody: unknown): SeqeraClient {
  return {
    config: {} as never,
    async fetchJson<T>(_path: string, _init?: RequestInit): Promise<T> {
      return responseBody as T
    },
    async fetchVoid() {},
  }
}

describe('createStudio', () => {
  const body = {
    name: 'test',
    computeEnvId: 'ce-1',
    dataStudioToolUrl: 'https://tool/studio',
    configuration: { environment: {}, cpu: 2, memory: 4096, lifespanHours: 8 },
    spot: false,
    remoteConfig: { repository: 'https://github.com/org/repo', revision: null, commitId: 'abc' },
  }

  // Regression: live Seqera API nests the session under `studio`
  it.todo('normalizes nested { studio: { sessionId } } response from live API', async () => {
    const client = fakeClient({ studio: { sessionId: 'sid-nested-123' } })
    const result = await createStudio(client, 42, body)
    assert.equal(result.sessionId, 'sid-nested-123')
  })

  it('passes through a flat { sessionId } response', async () => {
    const client = fakeClient({ sessionId: 'sid-flat-456' })
    const result = await createStudio(client, 42, body)
    assert.equal(result.sessionId, 'sid-flat-456')
  })
})
