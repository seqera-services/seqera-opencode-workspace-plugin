export interface GitMetadata {
  repository: string
  branch: string | null
  commitSha: string
  dirty: boolean
}

export function buildWorkspaceName(repository: string, branch: string | null, commitSha: string): string {
  const repo = repository
    .replace(/\.git$/i, '')
    .split('/')
    .filter(Boolean)
    .at(-1)
    ?.replace(/[^a-zA-Z0-9._-]+/g, '-')
    ?? 'workspace'

  const safeBranch = (branch ?? 'detached').replace(/[^a-zA-Z0-9._-]+/g, '-')
  const shortSha = commitSha.slice(0, 7)
  return `${repo}-${safeBranch}-${shortSha}`.toLowerCase()
}

function normalizeRepositoryUrl(repository: string): string {
  const githubSshMatch = repository.match(/^git@github\.com:([^/]+)\/([^\s]+?)(?:\.git)?$/i)
  if (githubSshMatch) {
    const [, owner, repo] = githubSshMatch
    return `https://github.com/${owner}/${repo}.git`
  }

  const githubSshUrlMatch = repository.match(/^ssh:\/\/git@github\.com\/([^/]+)\/([^\s]+?)(?:\.git)?$/i)
  if (githubSshUrlMatch) {
    const [, owner, repo] = githubSshUrlMatch
    return `https://github.com/${owner}/${repo}.git`
  }

  return repository
}

async function exec(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { execFile } = await import('node:child_process')
  const { promisify } = await import('node:util')
  const run = promisify(execFile)
  const { stdout } = await run(cmd, args, { encoding: 'utf8', cwd })
  return stdout.trim()
}

export async function readGitMetadata(cwd?: string): Promise<GitMetadata> {
  // Verify we're inside a git repo
  try {
    await exec('git', ['rev-parse', '--is-inside-work-tree'], cwd)
  } catch {
    throw new Error('Not inside a git repository')
  }

  // Read commit SHA (fails if HEAD is missing)
  let commitSha: string
  try {
    commitSha = await exec('git', ['rev-parse', 'HEAD'], cwd)
  } catch {
    throw new Error('HEAD does not point to a valid commit')
  }

  // Read branch (null when detached)
  let branch: string | null
  try {
    branch = await exec('git', ['symbolic-ref', '--short', 'HEAD'], cwd)
  } catch {
    branch = null
  }

  // Read remote URL — prefer 'origin', fall back to first available
  let repository: string
  try {
    repository = await exec('git', ['remote', 'get-url', 'origin'], cwd)
  } catch {
    try {
      const firstRemote = await exec('git', ['remote'], cwd)
      const remoteName = firstRemote.split('\n')[0]
      if (!remoteName) throw new Error('no remotes')
      repository = await exec('git', ['remote', 'get-url', remoteName], cwd)
    } catch {
      throw new Error('No suitable git remote found')
    }
  }

  // Check dirty state
  const status = await exec('git', ['status', '--porcelain'], cwd)
  const dirty = status.length > 0

  return { repository: normalizeRepositoryUrl(repository), branch, commitSha, dirty }
}
