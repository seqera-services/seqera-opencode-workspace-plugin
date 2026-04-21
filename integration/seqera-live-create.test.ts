import { execFile as execFileCb, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { buildWorkspaceName, readGitMetadata } from '../src/git.ts'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const execFile = promisify(execFileCb)
const testGitRef = process.env.SEQERA_LIVE_TEST_GIT_REF ?? 'origin/main'
const sharedToolPath = [join(repoRoot, 'node_modules', '.bin'), process.env.PATH ?? ''].filter(Boolean).join(delimiter)
const requiredEnv = [
  'SEQERA_LIVE_INTEGRATION',
  'SEQERA_API_BASE_URL',
  'SEQERA_API_TOKEN',
  'SEQERA_WORKSPACE_ID',
  'SEQERA_COMPUTE_ENV_ID',
  'SEQERA_DATA_STUDIO_TOOL_URL',
] as const
const missingEnv = requiredEnv.filter((name) => !process.env[name])
const skipReason = process.env.SEQERA_LIVE_INTEGRATION !== '1'
  ? 'set SEQERA_LIVE_INTEGRATION=1 to enable live Seqera integration tests'
  : missingEnv.length > 0
    ? `missing environment variables: ${missingEnv.join(', ')}`
    : false

test('live Seqera Studio create path returns a usable workspace record', { skip: skipReason, timeout: 10 * 60 * 1000 }, async () => {
  const worktreeDir = await mkdtemp(join(tmpdir(), 'seqera-opencode-worktree-'))
  await execFile('git', ['worktree', 'add', '--detach', worktreeDir, testGitRef], { cwd: repoRoot })
  await symlink(join(repoRoot, 'node_modules'), join(worktreeDir, 'node_modules'), 'dir')
  try {
    await execFile('npm', ['run', 'build'], {
      cwd: worktreeDir,
      env: { ...process.env, PATH: sharedToolPath },
    })
  } catch (error) {
    const detail = error instanceof Error && 'stdout' in error && 'stderr' in error
      ? `\nstdout:\n${String((error as { stdout?: string }).stdout ?? '')}\nstderr:\n${String((error as { stderr?: string }).stderr ?? '')}`
      : ''
    throw new Error(`failed to build plugin worktree at ${worktreeDir}${detail}`)
  }
  const git = await readGitMetadata(worktreeDir)
  const expectedName = buildWorkspaceName(git.repository, git.branch, git.commitSha)
  const workspaceId = Number(process.env.SEQERA_WORKSPACE_ID)
  const apiBaseUrl = process.env.SEQERA_API_BASE_URL as string
  const apiToken = process.env.SEQERA_API_TOKEN as string
  const port = String(18500 + Math.floor(Math.random() * 500))
  const opencodeHome = await mkdtemp(join(tmpdir(), 'seqera-opencode-live-'))
  const configDir = join(opencodeHome, '.config', 'opencode')
  const dataDir = join(opencodeHome, '.local', 'share')
  const cacheDir = join(opencodeHome, '.cache')
  await mkdir(configDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })
  await mkdir(cacheDir, { recursive: true })
  await writeFile(join(configDir, 'opencode.json'), JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    plugin: [`file://${worktreeDir}`],
  }, null, 2))

  let logs = ''
  const child = spawn('opencode', [
    'serve',
    '--hostname', '127.0.0.1',
    '--port', port,
    '--print-logs',
    '--log-level', 'INFO',
  ], {
    cwd: worktreeDir,
    env: {
      PATH: process.env.PATH ?? '',
      HOME: opencodeHome,
      XDG_CONFIG_HOME: join(opencodeHome, '.config'),
      XDG_DATA_HOME: dataDir,
      XDG_CACHE_HOME: cacheDir,
      OPENCODE_EXPERIMENTAL_WORKSPACES: 'true',
      SEQERA_API_BASE_URL: apiBaseUrl,
      SEQERA_API_TOKEN: apiToken,
      SEQERA_WORKSPACE_ID: process.env.SEQERA_WORKSPACE_ID as string,
      SEQERA_COMPUTE_ENV_ID: process.env.SEQERA_COMPUTE_ENV_ID as string,
      SEQERA_DATA_STUDIO_TOOL_URL: process.env.SEQERA_DATA_STUDIO_TOOL_URL as string,
      SEQERA_DEFAULT_SPOT: process.env.SEQERA_DEFAULT_SPOT ?? 'false',
      SEQERA_DEFAULT_LIFESPAN_HOURS: process.env.SEQERA_DEFAULT_LIFESPAN_HOURS ?? '24',
      SEQERA_STUDIO_POLL_TIMEOUT_MS: process.env.SEQERA_STUDIO_POLL_TIMEOUT_MS ?? '600000',
      SEQERA_STUDIO_POLL_INTERVAL_MS: process.env.SEQERA_STUDIO_POLL_INTERVAL_MS ?? '5000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { logs += chunk })
  child.stderr.on('data', (chunk) => { logs += chunk })

  let sessionId: string | undefined
  let localWorkspaceId: string | undefined

  try {
    await cleanupRemoteStudio({
      apiBaseUrl,
      apiToken,
      workspaceId,
      expectedName,
      expectedCommitId: git.commitSha,
    })

    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/experimental/workspace/adaptor`)
        if (!response.ok) return false
        const body = await response.json() as Array<{ type: string }>
        return body.some((item) => item.type === 'seqera-studio')
      } catch {
        return false
      }
    }, 60_000, 1_000, () => failureContext(logs))

    const response = await fetch(`http://127.0.0.1:${port}/experimental/workspace`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'seqera-studio', branch: git.branch, extra: null }),
    })
    const bodyText = await response.text()
    if (response.status !== 200) {
      const diag = await diagnoseSeqeraApi({ apiBaseUrl, apiToken, workspaceId })
      assert.fail(
        `workspace create returned ${response.status}\n${bodyText}\n` +
        `--- Seqera API diagnosis ---\n${diag}\n` +
        failureContext(logs),
      )
    }

    const workspace = JSON.parse(bodyText) as {
      id: string
      type: string
      name: string
      extra?: { sessionId?: string | null, studioUrl?: string | null, commitId?: string }
    }
    localWorkspaceId = workspace.id
    sessionId = workspace.extra?.sessionId ?? undefined

    assert.equal(workspace.type, 'seqera-studio')
    assert.equal(workspace.name, expectedName)
    assert.equal(workspace.extra?.commitId, git.commitSha)
    assert.ok(sessionId, `expected create response to include extra.sessionId\n${bodyText}`)
    assert.ok(workspace.extra?.studioUrl, `expected create response to include extra.studioUrl\n${bodyText}`)

    const listed = await fetch(`http://127.0.0.1:${port}/experimental/workspace`)
    const listedBody = await listed.json() as Array<{ id: string, extra?: { sessionId?: string | null, studioUrl?: string | null } }>
    const created = listedBody.find((item) => item.id === localWorkspaceId)
    assert.ok(created, 'expected created workspace to appear in the local workspace list')
    assert.equal(created?.extra?.sessionId, sessionId)
    assert.ok(created?.extra?.studioUrl)
  } finally {
    child.kill('SIGTERM')
    await Promise.race([once(child, 'exit'), sleep(5_000)])
    if (child.exitCode === null) child.kill('SIGKILL')
    await cleanupRemoteStudio({
      apiBaseUrl,
      apiToken,
      workspaceId,
      sessionId,
      expectedName,
      expectedCommitId: git.commitSha,
    }).catch((error) => {
      console.warn(`cleanup warning: ${String(error)}`)
    })
    await execFile('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: repoRoot })
    await rm(opencodeHome, { recursive: true, force: true })
  }
})

async function cleanupRemoteStudio(input: {
  apiBaseUrl: string
  apiToken: string
  workspaceId: number
  sessionId?: string
  expectedName: string
  expectedCommitId: string
}) {
  const sessionId = input.sessionId ?? await findStudioSessionId(input)
  if (!sessionId) return

  await fetch(`${input.apiBaseUrl}/studios/${encodeURIComponent(sessionId)}/stop?workspaceId=${input.workspaceId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${input.apiToken}` },
  }).catch(() => undefined)

  await waitFor(async () => {
    const response = await fetch(`${input.apiBaseUrl}/studios/${encodeURIComponent(sessionId)}?workspaceId=${input.workspaceId}`, {
      headers: { Authorization: `Bearer ${input.apiToken}` },
    }).catch(() => undefined)
    if (!response) return false
    if (response.status === 404) return true
    if (!response.ok) return false
    const studio = await response.json() as { statusInfo?: { status?: string | null } }
    const status = studio.statusInfo?.status?.toLowerCase()
    return status === 'stopped' || status === 'failed' || status === 'terminated'
  }, 60_000, 2_000).catch(() => undefined)

  await fetch(`${input.apiBaseUrl}/studios/${encodeURIComponent(sessionId)}?workspaceId=${input.workspaceId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${input.apiToken}` },
  }).catch(() => undefined)
}

async function findStudioSessionId(input: {
  apiBaseUrl: string
  apiToken: string
  workspaceId: number
  expectedName: string
  expectedCommitId: string
}) {
  const response = await fetch(`${input.apiBaseUrl}/studios?workspaceId=${input.workspaceId}`, {
    headers: { Authorization: `Bearer ${input.apiToken}` },
  })
  if (!response.ok) return undefined
  const body = await response.json() as {
    studios?: Array<{
      sessionId: string
      name?: string
      remoteConfig?: { commitId?: string | null }
    }>
  }
  return body.studios?.find((studio) =>
    studio.name === input.expectedName && studio.remoteConfig?.commitId === input.expectedCommitId,
  )?.sessionId
}

async function waitFor(check: () => Promise<boolean>, timeoutMs: number, intervalMs: number, context?: () => string) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await check()) return
    await sleep(intervalMs)
  }
  const suffix = context ? `\n${context()}` : ''
  throw new Error(`timed out after ${timeoutMs}ms${suffix}`)
}

function failureContext(logs: string) {
  const trimmed = logs.trim()
  const tail = trimmed.length > 6000 ? trimmed.slice(-6000) : trimmed
  return `opencode serve log tail:\n${tail}`
}

/** Probe each Seqera API step independently to pinpoint which one fails. */
async function diagnoseSeqeraApi(input: {
  apiBaseUrl: string
  apiToken: string
  workspaceId: number
}): Promise<string> {
  const headers = { Authorization: `Bearer ${input.apiToken}`, Accept: 'application/json' }
  const lines: string[] = []

  // 1. list studios
  try {
    const r = await fetch(`${input.apiBaseUrl}/studios?workspaceId=${input.workspaceId}`, { headers })
    const body = await r.text()
    lines.push(`list   ${r.status} ${r.statusText} (${body.length} bytes)`)
    if (!r.ok) lines.push(`  body: ${body.slice(0, 500)}`)
  } catch (err) {
    lines.push(`list   NETWORK_ERROR: ${String(err)}`)
  }

  // 2. describe a known studio (pick first from list if available)
  let sampleSessionId: string | undefined
  try {
    const r = await fetch(`${input.apiBaseUrl}/studios?workspaceId=${input.workspaceId}`, { headers })
    if (r.ok) {
      const data = await r.json() as { studios?: Array<{ sessionId: string }> }
      sampleSessionId = data.studios?.[0]?.sessionId
    }
  } catch { /* ignore */ }

  if (sampleSessionId) {
    try {
      const r = await fetch(`${input.apiBaseUrl}/studios/${encodeURIComponent(sampleSessionId)}?workspaceId=${input.workspaceId}`, { headers })
      const body = await r.text()
      lines.push(`describe(${sampleSessionId}) ${r.status} ${r.statusText} (${body.length} bytes)`)
      if (!r.ok) lines.push(`  body: ${body.slice(0, 500)}`)
    } catch (err) {
      lines.push(`describe NETWORK_ERROR: ${String(err)}`)
    }
  } else {
    lines.push('describe skipped — no existing studios to probe')
  }

  // 3. create dry-probe: POST with deliberately invalid body to distinguish 401/403 from 400
  try {
    const r = await fetch(`${input.apiBaseUrl}/studios?workspaceId=${input.workspaceId}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '__diag_probe__' }),
    })
    const body = await r.text()
    lines.push(`create-probe ${r.status} ${r.statusText}`)
    if (r.status === 401 || r.status === 403) {
      lines.push(`  ⚠ auth/permission issue on create: ${body.slice(0, 500)}`)
    } else if (r.status === 400) {
      lines.push('  create endpoint reachable (got 400 for invalid body — expected)')
    } else {
      lines.push(`  body: ${body.slice(0, 500)}`)
    }
  } catch (err) {
    lines.push(`create-probe NETWORK_ERROR: ${String(err)}`)
  }

  return lines.join('\n')
}
