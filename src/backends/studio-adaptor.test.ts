import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createStudioAdaptor } from './studio-adaptor.ts'
import type { SeqeraPluginConfig, WorkspaceInfo, StudioWorkspaceExtra } from '../types.ts'
import type { GitMetadata } from '../git.ts'
import type { SeqeraClient } from '../seqera/client.ts'
import type { CreateStudioResponse, DescribeStudioResponse } from '../seqera/studios.ts'

const baseConfig: SeqeraPluginConfig = {
  apiBaseUrl: 'https://api.seqera.test',
  apiToken: 'tok-test',
  workspaceId: 42,
  computeEnvId: 'ce-123',
  dataStudioToolUrl: 'https://tool.test/studio',
  defaultCpu: 2,
  defaultMemoryMb: 4096,
  defaultLifespanHours: 8,
  defaultSpot: false,
  studioPollTimeoutMs: 5000,
  studioPollIntervalMs: 100,
}

function makeInfo(overrides: Partial<WorkspaceInfo> = {}): WorkspaceInfo {
  return {
    id: 'ws-001',
    type: 'studio',
    name: 'test-workspace',
    branch: 'main',
    directory: '/tmp/repo',
    extra: null,
    projectID: 'proj-abc',
    ...overrides,
  }
}

const cleanGitMeta: GitMetadata = {
  repository: 'https://github.com/org/repo.git',
  branch: 'main',
  commitSha: 'abc1234567890def1234567890abcdef12345678',
  dirty: false,
}

function stubDeps(overrides: Record<string, unknown> = {}) {
  let describeCallCount = 0
  return {
    readGitMetadata: async (_cwd?: string): Promise<GitMetadata> => cleanGitMeta,
    createStudio: async (_client: SeqeraClient, _wsId: number, _body: unknown): Promise<CreateStudioResponse> =>
      ({ sessionId: 'sess-1' }),
    describeStudio: async (_client: SeqeraClient, _wsId: number, _sessionId: string): Promise<DescribeStudioResponse> => {
      describeCallCount++
      if (describeCallCount >= 2) {
        return { sessionId: 'sess-1', studioUrl: 'https://studio.test/sess-1', statusInfo: { status: 'RUNNING' } }
      }
      return { sessionId: 'sess-1', studioUrl: null }
    },
    deleteStudio: async (_client: SeqeraClient, _wsId: number, _sessionId: string): Promise<void> => {},
    resolveTargetHeaders: async (_studioUrl: string): Promise<Record<string, string> | undefined> => undefined,
    sleep: async (_ms: number): Promise<void> => {},
    ...overrides,
  }
}

describe('studio adaptor — configure', () => {
  it('populates extra with git metadata and workspace name', async () => {
    const adaptor = createStudioAdaptor(baseConfig, stubDeps())
    const info = makeInfo()
    const result = await adaptor.configure(info)

    const extra = result.extra as StudioWorkspaceExtra
    assert.equal(extra.backend, 'studio')
    assert.equal(extra.repository, 'https://github.com/org/repo.git')
    assert.equal(extra.commitId, 'abc1234567890def1234567890abcdef12345678')
    assert.equal(extra.branch, 'main')
    assert.equal(extra.workspaceId, 42)
    assert.equal(extra.computeEnvId, 'ce-123')
    assert.equal(extra.imageOrToolUrl, 'https://tool.test/studio')
    assert.equal(extra.spot, false)
    assert.equal(extra.sessionId, null)
    assert.equal(extra.studioUrl, null)
    assert.equal(result.name, 'repo-main-abc1234')
  })

  it('reads git metadata from info.directory', async () => {
    let capturedCwd: string | undefined
    const deps = stubDeps({
      readGitMetadata: async (cwd?: string) => {
        capturedCwd = cwd
        return cleanGitMeta
      },
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    await adaptor.configure(makeInfo({ directory: '/my/repo/path' }))
    assert.equal(capturedCwd, '/my/repo/path')
  })

  it('rejects dirty working tree', async () => {
    const deps = stubDeps({
      readGitMetadata: async () => ({ ...cleanGitMeta, dirty: true }),
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    await assert.rejects(
      () => adaptor.configure(makeInfo()),
      { message: /dirty|uncommitted/i },
    )
  })

  it('propagates git errors (not in repo)', async () => {
    const deps = stubDeps({
      readGitMetadata: async () => { throw new Error('Not inside a git repository') },
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    await assert.rejects(
      () => adaptor.configure(makeInfo()),
      { message: 'Not inside a git repository' },
    )
  })

  it('uses info.projectID for project context', async () => {
    const adaptor = createStudioAdaptor(baseConfig, stubDeps())
    const result = await adaptor.configure(makeInfo({ projectID: 'proj-xyz' }))
    assert.equal(result.projectID, 'proj-xyz')
  })
})

describe('studio adaptor — create', () => {
  function makeConfiguredInfo(sessionId: string | null = null): WorkspaceInfo {
    const extra: StudioWorkspaceExtra = {
      backend: 'studio',
      sessionId,
      workspaceId: 42,
      computeEnvId: 'ce-123',
      studioUrl: null,
      repository: 'https://github.com/org/repo.git',
      revision: 'main',
      commitId: 'abc1234567890def1234567890abcdef12345678',
      branch: 'main',
      imageOrToolUrl: 'https://tool.test/studio',
      spot: false,
      requestedAt: '2026-01-01T00:00:00.000Z',
      lastKnownStatus: null,
    }
    return makeInfo({ extra })
  }

  it('calls createStudio and polls until ready', async () => {
    let createCalled = false
    let describeCount = 0
    const deps = stubDeps({
      createStudio: async () => {
        createCalled = true
        return { sessionId: 'sess-new' }
      },
      describeStudio: async () => {
        describeCount++
        if (describeCount >= 2) {
          return { sessionId: 'sess-new', studioUrl: 'https://studio.test/sess-new', statusInfo: { status: 'RUNNING' } }
        }
        return { sessionId: 'sess-new', studioUrl: null }
      },
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    const info = makeConfiguredInfo()
    await adaptor.create(info, { OPENCODE_AUTH_CONTENT: 'auth-data' })

    assert.equal(createCalled, true)
    assert.ok(describeCount >= 2, 'should have polled describeStudio at least twice')
    const extra = info.extra as StudioWorkspaceExtra
    assert.equal(extra.sessionId, 'sess-new')
    assert.equal(extra.studioUrl, 'https://studio.test/sess-new')
  })

  it('passes bootstrap environment to createStudio', async () => {
    let capturedBody: unknown
    const deps = stubDeps({
      createStudio: async (_c: unknown, _w: unknown, body: unknown) => {
        capturedBody = body
        return { sessionId: 'sess-env' }
      },
      describeStudio: async () => ({ sessionId: 'sess-env', studioUrl: 'https://studio.test/x', statusInfo: { status: 'RUNNING' } }),
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    const info = makeConfiguredInfo()
    await adaptor.create(info, { OPENCODE_AUTH_CONTENT: 'auth-tok' })

    const body = capturedBody as { configuration: { environment: Record<string, string> } }
    assert.equal(body.configuration.environment.OPENCODE_AUTH_CONTENT, 'auth-tok')
    assert.equal(body.configuration.environment.OPENCODE_PROJECT_ID, 'proj-abc')
    assert.equal(body.configuration.environment.OPENCODE_GIT_REPOSITORY, 'https://github.com/org/repo.git')
  })

  it('times out if studio never becomes ready', async () => {
    const fastConfig = { ...baseConfig, studioPollTimeoutMs: 300, studioPollIntervalMs: 50 }
    const deps = stubDeps({
      describeStudio: async () => ({ sessionId: 'sess-slow', studioUrl: null }),
    })
    const adaptor = createStudioAdaptor(fastConfig, deps)
    await assert.rejects(
      () => adaptor.create(makeConfiguredInfo(), {}),
      { message: /timeout|timed out/i },
    )
  })

  it('retries readiness probing after the Studio URL appears', async () => {
    let describeCount = 0
    let readinessCount = 0
    const deps = stubDeps({
      describeStudio: async () => {
        describeCount++
        return { sessionId: 'sess-ready', studioUrl: 'https://studio.test/sess-ready', statusInfo: { status: 'RUNNING' } }
      },
      resolveTargetHeaders: async () => {
        readinessCount++
        if (readinessCount < 2) {
          throw new Error('OpenCode app not ready yet')
        }
        return { Cookie: 'connect-auth-sub=184; connect-auth-tokens=abc' }
      },
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    const info = makeConfiguredInfo()

    await adaptor.create(info, { OPENCODE_AUTH_CONTENT: 'auth-data' })

    assert.equal(describeCount, 2)
    assert.equal(readinessCount, 2)
    const extra = info.extra as StudioWorkspaceExtra
    assert.equal(extra.studioUrl, 'https://studio.test/sess-ready')
  })
})

describe('studio adaptor — remove', () => {
  it('calls deleteStudio when sessionId exists', async () => {
    let deletedSession: string | undefined
    const deps = stubDeps({
      deleteStudio: async (_c: unknown, _w: unknown, sessionId: string) => { deletedSession = sessionId },
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    const extra: StudioWorkspaceExtra = {
      backend: 'studio',
      sessionId: 'sess-del',
      workspaceId: 42,
      computeEnvId: 'ce-123',
      studioUrl: 'https://studio.test/sess-del',
      repository: 'https://github.com/org/repo.git',
      revision: 'main',
      commitId: 'abc123',
      branch: 'main',
      imageOrToolUrl: 'https://tool.test/studio',
      spot: false,
      requestedAt: '2026-01-01T00:00:00.000Z',
      lastKnownStatus: 'RUNNING',
    }
    await adaptor.remove(makeInfo({ extra }))
    assert.equal(deletedSession, 'sess-del')
  })

  it('skips delete when sessionId is null', async () => {
    let deleteCalled = false
    const deps = stubDeps({
      deleteStudio: async () => { deleteCalled = true },
    })
    const adaptor = createStudioAdaptor(baseConfig, deps)
    const extra: StudioWorkspaceExtra = {
      backend: 'studio',
      sessionId: null,
      workspaceId: 42,
      computeEnvId: 'ce-123',
      studioUrl: null,
      repository: 'https://github.com/org/repo.git',
      revision: 'main',
      commitId: 'abc123',
      branch: 'main',
      imageOrToolUrl: 'https://tool.test/studio',
      spot: false,
      requestedAt: '2026-01-01T00:00:00.000Z',
      lastKnownStatus: null,
    }
    await adaptor.remove(makeInfo({ extra }))
    assert.equal(deleteCalled, false)
  })
})

describe('studio adaptor — target', () => {
  it('returns remote target with studioUrl and resolved headers', async () => {
    const adaptor = createStudioAdaptor(baseConfig, stubDeps({
      resolveTargetHeaders: async () => ({ Cookie: 'connect-auth-sub=184; connect-auth-tokens=abc' }),
    }))
    const extra: StudioWorkspaceExtra = {
      backend: 'studio',
      sessionId: 'sess-t',
      workspaceId: 42,
      computeEnvId: 'ce-123',
      studioUrl: 'https://studio.test/sess-t',
      repository: 'https://github.com/org/repo.git',
      revision: 'main',
      commitId: 'abc123',
      branch: 'main',
      imageOrToolUrl: 'https://tool.test/studio',
      spot: false,
      requestedAt: '2026-01-01T00:00:00.000Z',
      lastKnownStatus: 'RUNNING',
    }
    const target = await adaptor.target(makeInfo({ extra }))
    assert.deepStrictEqual(target, {
      type: 'remote',
      url: 'https://studio.test/sess-t',
      headers: { Cookie: 'connect-auth-sub=184; connect-auth-tokens=abc' },
    })
  })

  it('returns remote target without headers when auth exchange is unnecessary', async () => {
    const adaptor = createStudioAdaptor(baseConfig, stubDeps())
    const extra: StudioWorkspaceExtra = {
      backend: 'studio',
      sessionId: 'sess-t',
      workspaceId: 42,
      computeEnvId: 'ce-123',
      studioUrl: 'https://studio.test/sess-t',
      repository: 'https://github.com/org/repo.git',
      revision: 'main',
      commitId: 'abc123',
      branch: 'main',
      imageOrToolUrl: 'https://tool.test/studio',
      spot: false,
      requestedAt: '2026-01-01T00:00:00.000Z',
      lastKnownStatus: 'RUNNING',
    }
    const target = await adaptor.target(makeInfo({ extra }))
    assert.deepStrictEqual(target, { type: 'remote', url: 'https://studio.test/sess-t' })
  })

  it('throws when studioUrl is not available', async () => {
    const adaptor = createStudioAdaptor(baseConfig, stubDeps())
    const extra: StudioWorkspaceExtra = {
      backend: 'studio',
      sessionId: 'sess-t',
      workspaceId: 42,
      computeEnvId: 'ce-123',
      studioUrl: null,
      repository: 'https://github.com/org/repo.git',
      revision: 'main',
      commitId: 'abc123',
      branch: 'main',
      imageOrToolUrl: 'https://tool.test/studio',
      spot: false,
      requestedAt: '2026-01-01T00:00:00.000Z',
      lastKnownStatus: null,
    }
    await assert.rejects(
      () => adaptor.target(makeInfo({ extra })),
      { message: /no studio url/i },
    )
  })
})
