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

  it('undefined plugin options must not wipe env-derived Seqera config', async () => {
    const originalEnv = { ...process.env }
    process.env.SEQERA_API_TOKEN = 'env-token-abc'
    process.env.SEQERA_API_BASE_URL = 'https://env.seqera.test'
    process.env.SEQERA_WORKSPACE_ID = '99'
    process.env.SEQERA_COMPUTE_ENV_ID = 'ce-env-456'
    process.env.SEQERA_DATA_STUDIO_TOOL_URL = 'https://env.tool.test/studio'

    try {
      // Simulate runtime options where some keys are explicitly undefined
      const plugin = createSeqeraWorkspacePlugin()

      let registeredAdaptor: WorkspaceAdaptor | undefined
      await plugin({
        client: {} as never,
        directory: '/tmp/repo',
        worktree: '/tmp/repo',
        serverUrl: new URL('http://127.0.0.1:4096'),
        $: {} as never,
        project: { id: 'proj-123' } as never,
        experimental_workspace: {
          register(_type: string, adaptor: WorkspaceAdaptor) {
            registeredAdaptor = adaptor
          },
        },
      } as never, {
        apiToken: undefined,
        apiBaseUrl: undefined,
        workspaceId: undefined,
        computeEnvId: undefined,
        dataStudioToolUrl: undefined,
      } as never)

      // The env-derived config must survive undefined overrides
      // We can't inspect config directly, but the adaptor should exist
      // and the config should have env values, not empty/zero defaults
      assert.ok(registeredAdaptor)

      // Use loadSeqeraPluginConfig directly to verify
      const { loadSeqeraPluginConfig } = await import('./seqera/config.ts')
      const config = loadSeqeraPluginConfig({
        apiToken: undefined,
        apiBaseUrl: undefined,
        workspaceId: undefined,
        computeEnvId: undefined,
        dataStudioToolUrl: undefined,
      } as never)

      assert.equal(config.apiToken, 'env-token-abc')
      assert.equal(config.apiBaseUrl, 'https://env.seqera.test')
      assert.equal(config.workspaceId, 99)
      assert.equal(config.computeEnvId, 'ce-env-456')
      assert.equal(config.dataStudioToolUrl, 'https://env.tool.test/studio')
    } finally {
      process.env = originalEnv
    }
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
