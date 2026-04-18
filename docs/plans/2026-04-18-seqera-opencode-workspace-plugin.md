# Seqera OpenCode workspace plugin Implementation Plan

> For Hermes: use subagent-driven-development if/when executing this plan.

Goal: ship a first working OpenCode experimental workspace plugin that provisions Seqera-backed remote workspaces.

Architecture: implement V1 against Seqera Platform Studios because Studios already expose a URL target; keep a scheduler-sandbox backend stub for future support once ingress exists or a relay is built. Use a local type shim for the current OpenCode plugin API mismatch around `create(info, env, from?)`.

Tech stack: TypeScript, fetch-based HTTP client, OpenCode plugin API, Seqera Platform Studio API.

---

## Task 1: Scaffold the repo for a design-first TypeScript plugin

Objective: create the minimum file layout so implementation can proceed incrementally.

Files:
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.ts`
- Create: `src/types.ts`

Steps:
1. Add `package.json` with `type: module` and TypeScript build scripts.
2. Add `tsconfig.json` targeting modern Node/Bun-compatible ESM.
3. Add `src/types.ts` with local definitions for:
   - plugin config
   - workspace extra schema
   - env-aware adaptor type shim
4. Add `src/index.ts` with a no-op registration skeleton.
5. Verify `tsc --noEmit` runs cleanly.

## Task 2: Add Seqera configuration loading

Objective: define how the plugin gets auth and backend settings.

Files:
- Create: `src/seqera/config.ts`
- Modify: `src/types.ts`
- Test: `src/seqera/config.test.ts`

Steps:
1. Define config inputs:
   - `SEQERA_API_TOKEN`
   - `SEQERA_API_BASE_URL` defaulting to `https://api.cloud.seqera.io`
   - `SEQERA_WORKSPACE_ID`
   - `SEQERA_COMPUTE_ENV_ID`
   - `SEQERA_DATA_STUDIO_TOOL_URL`
   - optional `SEQERA_SPOT`
2. Add validation with clear error messages.
3. Add tests for missing/invalid config.
4. Verify config loading does not perform network calls.

## Task 3: Collect local git metadata

Objective: derive the remote workspace source-of-truth from the current repo.

Files:
- Create: `src/git.ts`
- Test: `src/git.test.ts`

Steps:
1. Read current branch, commit SHA, origin URL, repo name, and dirty status.
2. Normalize origin URLs into a canonical HTTPS form when possible.
3. Add a helper to generate workspace names like `repo-branch-shortsha`.
4. Add tests for clean repo, detached HEAD, no remote, and dirty tree.

## Task 4: Implement a thin Seqera Studio client

Objective: wrap the Studio lifecycle endpoints behind stable functions.

Files:
- Create: `src/seqera/client.ts`
- Create: `src/seqera/studios.ts`
- Test: `src/seqera/studios.test.ts`

Steps:
1. Add an authenticated JSON `fetch` wrapper.
2. Implement `createStudio`.
3. Implement `describeStudio`.
4. Implement `deleteStudio`.
5. Add a reusable poll helper for readiness.
6. Add tests using mocked fetch responses.

## Task 5: Encode the bootstrap contract

Objective: define what the remote Studio image must do before we rely on it.

Files:
- Create: `src/bootstrap/contract.md`
- Create: `src/bootstrap/env.ts`
- Test: `src/bootstrap/env.test.ts`

Steps:
1. Document required env vars and expected paths.
2. Add code that transforms OpenCode env plus git metadata into Studio environment variables.
3. Include the `.git/opencode` requirement in the contract.
4. Add tests verifying the env map is deterministic.

## Task 6: Build the Studio-backed workspace adaptor

Objective: connect OpenCode lifecycle methods to Seqera Studio operations.

Files:
- Create: `src/backends/studio-adaptor.ts`
- Modify: `src/index.ts`
- Test: `src/backends/studio-adaptor.test.ts`

Steps:
1. Implement `configure(info)` to:
   - validate git state
   - derive workspace name
   - save remote metadata into `extra`
2. Implement `create(info, env)` to:
   - build the Studio create payload
   - merge environment
   - poll until `studioUrl` exists
3. Implement `target(info)` to return `{ type: "remote", url, headers }`.
4. Implement `remove(info)` to delete the Studio session idempotently.
5. Add tests for success and failure paths.

## Task 7: Add a sandbox placeholder backend

Objective: preserve the future design in code without blocking V1.

Files:
- Create: `src/seqera/sandboxes.ts`
- Create: `src/backends/sandbox-adaptor.ts`
- Test: `src/backends/sandbox-adaptor.test.ts`

Steps:
1. Add the request/response types for scheduler sandboxes.
2. Implement stubs that fail with a clear ingress-not-supported message.
3. Add tests asserting the error is actionable.

## Task 8: Document the auth and readiness spikes

Objective: prevent implementation from outrunning the unknowns.

Files:
- Create: `docs/spikes/studio-url-auth.md`
- Create: `docs/spikes/studio-bootstrap-image.md`

Steps:
1. Write the exact curl checks needed to verify bearer-token auth to `studioUrl`.
2. Write the exact image behavior expected from a custom Studio runtime.
3. Record the go/no-go criteria for Studio-backed V1.

## Task 9: Add a manual smoke-test script

Objective: make the first end-to-end validation repeatable.

Files:
- Create: `scripts/smoke-studio-workspace.ts`
- Create: `docs/smoke-test.md`

Steps:
1. Provision a Studio using real config.
2. Poll for readiness.
3. Hit `/health` or equivalent on the returned URL.
4. Tear the Studio down.
5. Document the exact command to run.

## Task 10: Final polish

Objective: leave the repo easy to iterate on.

Files:
- Modify: `README.md`
- Modify: `docs/plugin-design.md`

Steps:
1. Update README with actual status once implementation starts.
2. Remove any outdated notes about the upstream API mismatch if fixed.
3. Keep the design doc aligned with the code layout.
4. Add a short “known blockers” section if Studio auth or ingress remains unresolved.
