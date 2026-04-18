# Initial plugin spec

Status: approved working direction for V1

## Objective

Ship a minimal but real OpenCode experimental workspace plugin that provisions a Seqera-hosted remote workspace and returns a working OpenCode `remote` target.

## Product decision summary

1. Backend choice
- V1 backend is Seqera Platform Studio only.
- Scheduler sandboxes are explicitly out of scope for V1.

2. Git source-of-truth
- V1 supports committed Git revisions only.
- V1 requires a detectable Git remote suitable for remote checkout.
- V1 does not support dirty local changes.

3. Remote runtime contract
- The remote environment must run `opencode serve`.
- The plugin must inject OpenCode env into the remote runtime.
- The remote runtime must write the current OpenCode project id into `.git/opencode`.

4. Connectivity contract
- `target()` must return a `remote` target using the Studio URL.
- The returned URL must work for normal OpenCode traffic and `/sync/replay`.
- The plugin will attach bearer auth headers if needed.

5. Failure policy
- Prefer failing in `configure()` when the local repo is not suitable.
- `create()` should only handle provisioning and readiness.

## V1 non-goals

- syncing uncommitted local files
- patching a live Studio from a dirty working tree
- sandbox relay / tunnel layer
- multi-backend abstraction beyond a clean seam in code
- forking from another workspace via `from?`

## Required plugin configuration

All of these should be configurable via plugin options, env, or both.

```ts
{
  apiBaseUrl: string            // default https://api.cloud.seqera.io
  apiToken: string
  workspaceId: number
  computeEnvId: string
  dataStudioToolUrl: string
  defaultCpu?: number           // default 4
  defaultMemoryMb?: number      // default 16384
  defaultLifespanHours?: number // default 8
  defaultSpot?: boolean         // default true
  studioPollTimeoutMs?: number  // default 10m
  studioPollIntervalMs?: number // default 5s
}
```

## Local preflight rules

`configure()` must validate:
- inside a Git repo
- HEAD resolves to a commit SHA
- repo remote exists
- remote is convertible to a stable clone URL
- working tree is clean

`configure()` should derive:
- workspace name: `<repo>-<branch>-<shortsha>`
- branch
- commit SHA
- repository URL
- dirty flag

## Stored workspace metadata

The plugin should persist this in `WorkspaceInfo.extra`:

```ts
{
  backend: "studio",
  sessionId: string | null,
  workspaceId: number,
  computeEnvId: string,
  studioUrl: string | null,
  repository: string,
  revision: string | null,
  commitId: string,
  branch: string | null,
  imageOrToolUrl: string,
  spot: boolean,
  requestedAt: string,
  lastKnownStatus: string | null,
}
```

## Seqera API mapping

### create

Request:
- `POST /studios?workspaceId={workspaceId}&autoStart=true`

Body shape:

```json
{
  "name": "repo-branch-ab12cd3",
  "computeEnvId": "ce-12345",
  "dataStudioToolUrl": "ghcr.io/seqeralabs/opencode-studio:latest",
  "configuration": {
    "environment": {
      "OPENCODE_AUTH_CONTENT": "...",
      "OPENCODE_WORKSPACE_ID": "...",
      "OPENCODE_EXPERIMENTAL_WORKSPACES": "true",
      "OPENCODE_PROJECT_ID": "...",
      "OPENCODE_GIT_REPOSITORY": "https://github.com/org/repo.git",
      "OPENCODE_GIT_COMMIT": "abc123...",
      "OPENCODE_GIT_BRANCH": "main"
    },
    "cpu": 4,
    "memory": 16384,
    "lifespanHours": 8
  },
  "spot": true,
  "remoteConfig": {
    "repository": "https://github.com/org/repo.git",
    "revision": "main",
    "commitId": "abc123..."
  }
}
```

### readiness polling

Poll:
- `GET /studios/:sessionId?workspaceId={workspaceId}`

Ready when:
- `studioUrl` is non-empty
- status is in an allowlist such as `RUNNING`, `READY`, or equivalent resolved state from `statusInfo`
- **after** an application-level health probe confirms `opencode serve` is responding (Studio container up ≠ inner process ready)

### target

Return:

```ts
{
  type: "remote",
  url: studioUrl,
  headers: {
    Authorization: `Bearer ${token}`,
  },
}
```

**Auth risk**: `apiToken` authenticates to the Platform API. `studioUrl` is a different endpoint — it likely uses session-cookie auth, not API bearer tokens. The spike must determine the correct token source. If bearer auth doesn't work, V1 needs either a Studio-issued session token or an auth-aware relay.

### remove

Call:
- `DELETE /studios/:sessionId?workspaceId={workspaceId}`

## Bootstrap image contract

The Studio image or tool must:
1. make the repo available in the working directory
2. write `.git/opencode` with the OpenCode project id
3. preserve provided environment variables for the OpenCode server process
4. run `opencode serve`
5. expose it behind the returned Studio URL

## Initial code layout

```text
src/
  index.ts
  types.ts
  git.ts
  seqera/
    config.ts
    client.ts
    studios.ts
    sandboxes.ts
  backends/
    studio-adaptor.ts
    sandbox-adaptor.ts
  bootstrap/
    env.ts
    contract.md
```

## Acceptance criteria for V1

A V1 smoke test is successful when all are true:
1. OpenCode can register the plugin.
2. Creating a workspace provisions a Studio.
3. The plugin persists `sessionId` and `studioUrl`.
4. `target()` returns a reachable remote URL.
5. OpenCode can connect and replay into `/sync/replay`.
6. Removing the workspace tears the Studio down.

## Open questions to spike immediately

Ordered by blast radius — if 1–3 fail, Studio V1 is blocked.

1. **Auth on `studioUrl`**: does it accept Platform API bearer auth, or only browser session cookies? (Most likely: separate auth domain. Plan for it.)
2. **Port and path routing**: what port must the Studio tool process listen on? Does the Studio proxy pass `/sync/replay` through transparently?
3. **Repo materialization path**: when `remoteConfig` is provided, where does the checkout land inside the container? Is it deterministic?
4. **`configuration.environment` format**: flat `Record<string,string>` or `[{name,value}]` array?
5. **`OPENCODE_PROJECT_ID` origin**: where does this value come from — the `env` arg to `create()`, `WorkspaceInfo`, or derived?
6. **`statusInfo` allowlist**: what exact values mean the Studio container is running?
7. **Spot/lifespan recovery**: when a Studio dies, should the plugin re-provision or surface the error?
8. Does the Studio runtime need a wrapper entrypoint around `opencode serve`?
9. Is there any Seqera-supported way to approximate dirty-tree sync without inventing our own transport?
