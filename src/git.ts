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

export async function readGitMetadata(): Promise<GitMetadata> {
  throw new Error('Git metadata collection is not implemented yet')
}
