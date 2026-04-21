# Seqera OpenCode workspace plugin design

## Goal

Provide an OpenCode experimental workspace adaptor that creates a remote Seqera-backed environment, runs `opencode serve` inside it, and returns a `remote` target so OpenCode can proxy requests into that workspace.

Relevant upstream interface
- OpenCode gist: `experimental_workspace.register(type, adaptor)`
- Internal control-plane adaptor shape:
  - `configure(info)`
  - `create(info, env, from?)`
  - `remove(info)`
  - `target(info)`
- Remote targets must expose a reachable URL and must support replay to `/sync/replay` during session restore.

## Hard constraints from the upstream design

A working remote workspace needs all of the following:
1. `opencode serve` running inside the remote environment
2. OpenCode-provided env vars injected into that process, especially:
   - `OPENCODE_AUTH_CONTENT`
   - `OPENCODE_WORKSPACE_ID`
   - `OPENCODE_EXPERIMENTAL_WORKSPACES=true`
3. `.git/opencode` populated with the project id inside the remote repo
4. A stable URL that OpenCode can call directly and reuse for `/sync/replay`

## Backend options

### Option A: Seqera Platform Studio

Useful APIs
- `POST https://api.cloud.seqera.io/studios?workspaceId=...&autoStart=true`
- `GET  https://api.cloud.seqera.io/studios/:sessionId?workspaceId=...`
- `PUT  https://api.cloud.seqera.io/studios/:sessionId/start?workspaceId=...`
- `PUT  https://api.cloud.seqera.io/studios/:sessionId/stop?workspaceId=...`
- `DELETE https://api.cloud.seqera.io/studios/:sessionId?workspaceId=...`

Useful request fields
- `name`
- `computeEnvId`
- `dataStudioToolUrl`
- `configuration.environment`
- `configuration.cpu`
- `configuration.memory`
- `configuration.gpu`
- `configuration.lifespanHours`
- `spot`
- `remoteConfig.repository`
- `remoteConfig.revision`
- `remoteConfig.commitId`

Useful response fields
- `sessionId`
- `studioUrl`
- `statusInfo`
- `remoteConfig`

Strengths
- Already exposes a URL (`studioUrl`), which maps cleanly to OpenCode `target()`.
- Has first-class lifecycle operations.
- Allows environment injection and repo checkout metadata.
- Likely the fastest route to a usable V1.

Weaknesses
- No file upload API in the public Platform Studio API docs.
- Cleanly supports committed Git revisions; does not naturally support dirty local trees.
- Requires a custom image/tool setup that starts `opencode serve` as the primary app behind the Studio URL.
- The Studio URL is not directly bearer-token accessible. In dev validation, it first required the Seqera authorize flow to mint `connect-auth-*` cookies before the OpenCode server became reachable.
- `OPENCODE_SERVER_PASSWORD` is optional for Studio use. With Studio auth cookies present, a runtime without that variable served OpenCode normally.

### Option B: Seqera Scheduler sandbox

Useful APIs
- `POST /v1a1/sandboxes/`
- `GET /v1a1/sandboxes/{sandboxId}`
- `DELETE /v1a1/sandboxes/{sandboxId}`
- `POST /v1a1/sandboxes/{sandboxId}/exec`
- `POST /v1a1/sandboxes/{sandboxId}/exec-stream`
- `GET /v1a1/sandboxes/{sandboxId}/files`
- `POST /v1a1/sandboxes/{sandboxId}/files`
- `DELETE /v1a1/sandboxes/{sandboxId}/files`

Useful request fields
- `image`
- `region`
- `timeoutMinutes`
- `envVars`
- `provider`
- `workspaceId`
- `computeEnvId`
- `workDir`

Strengths
- Better bootstrap primitives than Studio.
- Supports direct env injection.
- Supports file upload and command execution.
- Supports persistent `workDir` via Fusion/S3, which is attractive for durable remote workspaces.

Weaknesses
- Public schema shows no ingress URL, exposed port, or tunnel API.
- OpenCode `target()` currently needs a reachable HTTP URL.
- Without ingress, we would need an additional bridge/proxy layer.

## Recommendation

Build V1 on Platform Studio.

Reasoning:
- The hardest OpenCode requirement is not creation; it is returning a live HTTP target.
- Studio has a native URL today.
- Scheduler sandboxes are operationally appealing, but they do not appear to satisfy `target()` without extra infrastructure.

Then build V2 sandbox support when one of these becomes true:
- Scheduler exposes a sandbox URL or port-forward endpoint, or
- We intentionally build a local bridge service that presents an HTTP OpenCode endpoint and translates requests to sandbox APIs.

## V1 architecture (Studio-backed)

### Components

1. Plugin entrypoint
   - Registers `seqera-studio` as an experimental workspace type.

2. Seqera API client
   - Wraps Platform Studio API calls.
   - Handles bearer auth, polling, retries, and error shaping.

3. Git context collector
   - Reads current repo remote, branch, commit SHA, and dirty state.
   - V1 should require a committed revision and ideally a pushed remote.

4. Bootstrap image contract
   - A custom Studio image or tool URL whose container starts `opencode serve`.
   - Entry point responsibilities:
     - checkout the requested repo/revision if Seqera has not already materialized it
     - write `.git/opencode`
     - export/inherit OpenCode env vars
     - start `opencode serve`

5. Workspace metadata serializer
   - Persists Studio identifiers and remote context in `WorkspaceInfo.extra`.

### Proposed `WorkspaceInfo.extra` schema

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

### Lifecycle mapping

#### `configure(info)`

Responsibilities
- Derive a stable workspace name, for example:
  - `<repo>-<branch>-<shortsha>`
- Validate local prerequisites:
  - inside a git repo
  - remote origin exists
  - commit exists
- Save derived remote metadata into `extra`
- If the tree is dirty, either:
  - fail with a clear message in V1, or
  - allow only if the user explicitly opts into detached/approximate behavior

#### `create(info, env)`

Responsibilities
1. Build the Studio create payload.
2. Merge OpenCode env into `configuration.environment`.
3. Call `POST /studios?...`.
4. Poll `GET /studios/:sessionId?...` until:
   - status is ready/running enough for connection, and
   - `studioUrl` is present
5. Persist `sessionId` and `studioUrl` into `info.extra`.

Suggested payload shape

```json
{
  "name": "repo-branch-ab12cd3",
  "computeEnvId": "ce-12345",
  "dataStudioToolUrl": "ghcr.io/seqeralabs/opencode-studio:latest",
  "configuration": {
    "environment": {
      "OPENCODE_AUTH_CONTENT": "...",
      "OPENCODE_WORKSPACE_ID": "ws_...",
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

#### `target(info)`

Return

```ts
{
  type: "remote",
  url: studioUrl,
  headers: {
    Authorization: `Bearer ${token}`,
  },
}
```

Important open questions
- **Studio auth chain**: in dev validation, `studioUrl` did not accept the Platform bearer token directly. It first redirected through the Seqera authorize flow, which minted `connect-auth-*` cookies for the Studio host. The repo now has a V1 implementation of that exchange in `src/seqera/studio-auth.ts`, and `target()` returns the resulting `Cookie` header on the remote target.
- **Attach compatibility**: direct `opencode attach` to the raw Studio URL still failed from local clients (`1.2.24`, `1.4.3`, and `1.14.19`) before a usable remote session formed. However, newer clients did advance past the original `.toSorted(...)` crash, and the remaining blocker is still the Studio auth boundary rather than the OpenCode runtime itself.
- **Plugin runtime support**: the current local OpenCode runtime does provide `experimental_workspace.register()` to loaded plugins and passes the bootstrap env map as the second `create(...)` argument at runtime. The published `@opencode-ai/plugin` typings still lag on the adaptor signature, so this repo keeps a local shim for the `create(info, env, from?)` contract.
- **Port/path routing**: with valid Studio auth cookies, the OpenCode app was reachable and `/sync/replay` returned `200`, but we still need to prove semantic replay/session-restore behavior, not just route reachability.
- **Inner-process readiness**: Studio status `RUNNING` means the container is up, not that `opencode serve` is listening. The adaptor now probes `/experimental/session` through the auth exchange before treating the Studio as ready.

#### `remove(info)`

Call
- `DELETE /studios/:sessionId?workspaceId=...`

Optional future enhancement
- If delete fails because the Studio is merely stopped, try `stop` then `delete`.

## V2 architecture (Scheduler sandbox-backed)

Only pursue once ingress is solved.

### Direct mode, if ingress lands

1. `POST /v1a1/sandboxes/` with:
   - `image`
   - `envVars`
   - `workspaceId` or `computeEnvId`
   - `workDir`
2. Upload repo tarball or sync files if needed.
3. Run bootstrap command through exec API.
4. Discover sandbox URL from the new ingress API.
5. Return that URL from `target()`.

### Bridge mode, if ingress does not land

Bridge responsibilities
- Run a small local HTTP service on `127.0.0.1`.
- Expose the HTTP endpoints OpenCode expects from a remote workspace.
- Forward file/process requests to sandbox exec/file APIs.

This is substantially more complex than V1 and should not be the first implementation.

## Upstream mismatch to account for

There is a real API mismatch today:
- The OpenCode gist and control-plane types use `create(info, env, from?)`.
- The current `@opencode-ai/plugin` dev package snapshot still shows `create(config, from?)`.

Plan
- Implement a local compatibility type for the workspace adaptor.
- Cast the adaptor registration boundary if needed.
- Remove the shim once the plugin package exports the env-aware signature.

V1 ignores the `from?` parameter entirely — workspace forking is out of scope.

## Failure model and UX

Expected user-visible errors
- not in a git repo
- no remote origin
- dirty tree not supported in Studio mode
- Studio image missing required bootstrap behavior
- Studio URL never became available
- Studio URL unavailable to bearer-token auth
- compute environment mismatch or workspace access denied

Desired UX
- Fail in `configure()` whenever possible.
- Keep `create()` focused on remote provisioning and readiness polling.
- Persist enough metadata in `extra` to make `remove()` idempotent and debuggable.

## Suggested repo layout

```text
src/
  index.ts               # plugin registration
  types.ts               # local workspace extra schema + shim types
  git.ts                 # repo metadata collection
  seqera/
    config.ts            # env/config loading
    client.ts            # HTTP wrapper
    studios.ts           # Studio lifecycle ops
    sandboxes.ts         # future backend
  backends/
    studio-adaptor.ts    # V1 adaptor
    sandbox-adaptor.ts   # V2 placeholder
  bootstrap/
    contract.md          # image/container expectations
```

## Assumptions to validate before implementation

These are load-bearing assumptions. If any of 1–4 fail, Studio-backed V1 is blocked.

1. **Custom Studio image**: can a Studio run `opencode serve` as its primary process, and does the Studio proxy route HTTP to the expected port?
2. **Auth on `studioUrl`**: is `studioUrl` callable with a Platform API bearer token, or does it require a separate session/cookie auth? (Most likely: separate. Plan for it.)
3. **Path transparency**: does `/sync/replay` on `studioUrl` reach the inner process, or does Studio rewrite/intercept paths?
4. **Repo materialization**: when `remoteConfig` is provided, where does the checkout land? Is the path deterministic and writable for `.git/opencode`?
5. **`configuration.environment` wire format**: confirm the Platform API accepts `Record<string,string>`. Some Seqera APIs use `[{name: string, value: string}]` instead.
6. **`OPENCODE_PROJECT_ID` source**: this appears in the create payload but its origin is never specified. Confirm whether it comes from the `env` parameter passed to `create()`, from `WorkspaceInfo`, or must be derived from `.git/opencode`.
7. **Spot/lifespan termination**: when a Studio is terminated (spot reclaim or lifespan expiry), `target()` returns a dead URL. Decide whether the plugin should detect this and re-provision, or surface the error to OpenCode for the user to handle.

If 1–3 fail, switch to sandbox + relay.
