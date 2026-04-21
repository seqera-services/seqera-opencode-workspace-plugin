import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createSeqeraWorkspacePlugin, server } from './index.ts'
import type { WorkspaceAdaptor } from './types.ts'

describe('index plugin entrypoint', () => {
  it('registers the seqera-studio workspace adaptor', async () => {
    let registeredType: string | undefined
    let registeredAdaptor: WorkspaceAdaptor | undefined

    const plugin = createSeqeraWorkspacePlugin({
      apiBaseUrl: 'https://api.seqera.test',
      apiToken: 'tok-test',
      workspaceId: 42,
      computeEnvId: 'ce-123',
      dataStudioToolUrl: 'https://tool.test/studio',
      defaultCpu: 2,
      defaultMemoryMb: 4096,
      defaultLifespanHours: 8,
      defaultSpot: false,
      studioPollTimeoutMs: 1000,
      studioPollIntervalMs: 100,
    })

    const result = await plugin({
      client: {} as never,
      directory: '/tmp/repo',
      worktree: '/tmp/repo',
      serverUrl: new URL('http://127.0.0.1:4096'),
      $: {} as never,
      project: { id: 'proj-123' } as never,
      experimental_workspace: {
        register(type: string, adaptor: WorkspaceAdaptor) {
          registeredType = type
          registeredAdaptor = adaptor
        },
      },
    } as never)

    assert.deepEqual(result, {})
    assert.equal(registeredType, 'seqera-studio')
    assert.ok(registeredAdaptor)
    assert.equal(registeredAdaptor?.name, 'Seqera Studio')
  })

  it('throws a clear error when the runtime lacks experimental workspace registration', async () => {
    const plugin = createSeqeraWorkspacePlugin({
      apiBaseUrl: 'https://api.seqera.test',
      apiToken: 'tok-test',
      workspaceId: 42,
      computeEnvId: 'ce-123',
      dataStudioToolUrl: 'https://tool.test/studio',
      defaultCpu: 2,
      defaultMemoryMb: 4096,
      defaultLifespanHours: 8,
      defaultSpot: false,
      studioPollTimeoutMs: 1000,
      studioPollIntervalMs: 100,
    })

    await assert.rejects(
      () => plugin({
        client: {} as never,
        directory: '/tmp/repo',
        worktree: '/tmp/repo',
        serverUrl: new URL('http://127.0.0.1:4096'),
        $: {} as never,
        project: { id: 'proj-123' } as never,
      } as never),
      { message: /experimental_workspace\.register\(\)/ },
    )
  })

  it('exports a ready-to-load default server plugin', async () => {
    let registeredType: string | undefined

    const result = await server({
      client: {} as never,
      directory: '/tmp/repo',
      worktree: '/tmp/repo',
      serverUrl: new URL('http://127.0.0.1:4096'),
      $: {} as never,
      project: { id: 'proj-123' } as never,
      experimental_workspace: {
        register(type: string) {
          registeredType = type
        },
      },
    } as never, {
      apiBaseUrl: 'https://api.seqera.test',
      apiToken: 'tok-test',
      workspaceId: 42,
      computeEnvId: 'ce-123',
      dataStudioToolUrl: 'https://tool.test/studio',
      defaultCpu: 2,
      defaultMemoryMb: 4096,
      defaultLifespanHours: 8,
      defaultSpot: false,
      studioPollTimeoutMs: 1000,
      studioPollIntervalMs: 100,
    })

    assert.deepEqual(result, {})
    assert.equal(registeredType, 'seqera-studio')
  })
})
