import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFile as execFileCb } from 'node:child_process'
import { promisify } from 'node:util'
import { buildWorkspaceName, readGitMetadata } from './git.ts'

const execFile = promisify(execFileCb)

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFile('git', args, { encoding: 'utf8', cwd })
  return stdout.trim()
}

/** Create a temp git repo with one commit and a remote named 'origin'. */
async function makeTempRepo(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'git-meta-test-'))
  await git(['init', '-b', 'main'], dir)
  await git(['config', 'user.email', 'test@test.com'], dir)
  await git(['config', 'user.name', 'Test'], dir)
  await execFile('touch', ['file.txt'], { cwd: dir })
  await git(['add', 'file.txt'], dir)
  await git(['commit', '-m', 'init'], dir)
  await git(['remote', 'add', 'origin', 'https://github.com/org/repo.git'], dir)
  return dir
}

describe('buildWorkspaceName', () => {
  it('strips .git suffix and uses last path segment', () => {
    assert.equal(
      buildWorkspaceName('https://github.com/org/repo.git', 'main', 'abc1234def'),
      'repo-main-abc1234',
    )
  })

  it('handles branch with slashes', () => {
    assert.equal(
      buildWorkspaceName('https://github.com/org/repo', 'feat/new-thing', 'abc1234def'),
      'repo-feat-new-thing-abc1234',
    )
  })

  it('uses "detached" when branch is null', () => {
    assert.equal(
      buildWorkspaceName('https://github.com/org/repo', null, 'abc1234def'),
      'repo-detached-abc1234',
    )
  })

  it('lowercases the result', () => {
    assert.equal(
      buildWorkspaceName('https://github.com/org/MyRepo.git', 'Main', 'ABC1234DEF'),
      'myrepo-main-abc1234',
    )
  })

  it('replaces unsafe characters with dashes', () => {
    assert.equal(
      buildWorkspaceName('https://github.com/org/my repo!', 'feat@2', 'abc1234def'),
      'my-repo--feat-2-abc1234',
    )
  })

  it('falls back to "workspace" for degenerate repo URL', () => {
    assert.equal(
      buildWorkspaceName('', 'main', 'abc1234def'),
      'workspace-main-abc1234',
    )
  })
})

describe('readGitMetadata', () => {
  let dir: string

  before(async () => {
    dir = await makeTempRepo()
  })

  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('returns full metadata from a repo with a remote', async () => {
    const meta = await readGitMetadata(dir)
    assert.equal(meta.repository, 'https://github.com/org/repo.git')
    assert.match(meta.commitSha, /^[0-9a-f]{40}$/)
    assert.equal(meta.branch, 'main')
    assert.equal(meta.dirty, false)
  })

  it('reports dirty when working tree has changes', async () => {
    await execFile('touch', ['untracked.txt'], { cwd: dir })
    const meta = await readGitMetadata(dir)
    assert.equal(meta.dirty, true)
    // clean up
    await execFile('rm', ['untracked.txt'], { cwd: dir })
  })

  it('returns null branch on detached HEAD', async () => {
    const sha = await git(['rev-parse', 'HEAD'], dir)
    await git(['checkout', '--detach', sha], dir)
    const meta = await readGitMetadata(dir)
    assert.equal(meta.branch, null)
    await git(['checkout', 'main'], dir)
  })

  it('falls back to first remote when origin is absent', async () => {
    await git(['remote', 'rename', 'origin', 'upstream'], dir)
    const meta = await readGitMetadata(dir)
    assert.equal(meta.repository, 'https://github.com/org/repo.git')
    await git(['remote', 'rename', 'upstream', 'origin'], dir)
  })

  it('throws when no remotes exist', async () => {
    await git(['remote', 'remove', 'origin'], dir)
    await assert.rejects(
      () => readGitMetadata(dir),
      { message: 'No suitable git remote found' },
    )
    await git(['remote', 'add', 'origin', 'https://github.com/org/repo.git'], dir)
  })

  it('throws when not in a git repo', async () => {
    const notGit = await mkdtemp(join(tmpdir(), 'not-git-'))
    await assert.rejects(
      () => readGitMetadata(notGit),
      { message: 'Not inside a git repository' },
    )
    await rm(notGit, { recursive: true, force: true })
  })

  it('throws when HEAD is missing', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'empty-git-'))
    await git(['init'], empty)
    await assert.rejects(
      () => readGitMetadata(empty),
      { message: 'HEAD does not point to a valid commit' },
    )
    await rm(empty, { recursive: true, force: true })
  })
})
