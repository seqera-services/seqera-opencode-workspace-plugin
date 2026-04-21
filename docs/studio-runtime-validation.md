# Studio runtime validation notes

Status: empirical validation against Seqera Cloud dev on 2026-04-21

## What was validated

A minimal Studio image under `.seqera/` was built with Wave and launched successfully as a real Seqera Studio in the dev environment.

Successful Wave build command:

```bash
cd .seqera
wave -f Dockerfile \
  --context . \
  --platform linux/amd64 \
  --await 20m \
  --tower-token "$TOWER_ACCESS_TOKEN" \
  --tower-endpoint https://cloud.dev-seqera.io/api \
  --wave-endpoint https://wave.dev-seqera.io
```

Important note:
- `--tower-endpoint https://cloud.dev-seqera.io/api` worked
- `--tower-endpoint https://api.cloud.dev-seqera.io` failed with `Missing pairing record for Tower endpoint ...`

A real Studio was then launched in workspace `data-studios/data-studios` using the Wave-built image and reached `RUNNING` state.

## OpenCode server proof

Once the Studio was running, the application behind the Studio URL was verified to be OpenCode itself.

Observed behavior:
1. Unauthenticated `GET /` to the Studio URL redirected to Seqera authorize flow.
2. Following the authorize redirect with a valid Platform bearer token yielded `connect-auth-*` cookies on the Studio host.
3. With those cookies present:
   - a Studio launched **without** `OPENCODE_SERVER_PASSWORD` returned `200 OK` from `/`
   - the HTML page title was `OpenCode`
   - `GET /session` returned `[]`
   - `GET /experimental/workspace` returned `[]`
4. For a Studio launched **with** `OPENCODE_SERVER_PASSWORD`, the Studio host returned `401` with `www-authenticate: Basic realm="Secure Area"`, and the correct credentials were:
   - username: `opencode`
   - password: the configured `OPENCODE_SERVER_PASSWORD`

This proves that the runtime is serving the real OpenCode application behind the Studio URL, not just a generic web server.

## OPENCODE_SERVER_PASSWORD conclusion

`OPENCODE_SERVER_PASSWORD` is not strictly required for Studio use.

Why:
- Seqera Studio auth already gates access to the Studio URL via the authorize redirect and `connect-auth-*` cookies.
- After that auth flow, a Studio without `OPENCODE_SERVER_PASSWORD` was reachable and served OpenCode normally.

Recommendation:
- keep `OPENCODE_SERVER_PASSWORD` optional in the runtime
- default to **disabled** unless a caller explicitly wants an extra auth layer

Caveat:
- enabling it adds a second auth layer that may be useful for defense in depth, but it is not sufficient by itself because Seqera auth still happens first

## Attach/session flow findings

Direct CLI attach to the raw Studio URL is still blocked.

Observed behavior with `opencode attach https://<studio-url>`:
- current local OpenCode clients (`1.2.24` and `1.4.3`) both failed before establishing a usable remote session
- the failure looked like:

```text
(x6.data ?? []).toSorted is not a function
```

Source inspection of OpenCode `1.4.3` showed that the attach TUI bootstrap calls `sdk.client.session.list(...).then((x) => (x.data ?? []).toSorted(...))` very early in `packages/opencode/src/cli/cmd/tui/context/sync.tsx`.

The critical follow-up experiment was:
1. mint valid Seqera Studio `connect-auth-*` cookies through the authorize flow
2. place a tiny local reverse proxy in front of the Studio URL that injects those cookies on every request
3. run `opencode attach http://127.0.0.1:<proxy-port>` against that proxy

Result:
- attach through the cookie-injecting proxy advanced past the previous `.toSorted(...)` crash and entered the normal TUI bootstrap path
- the same `1.4.3` client still crashed immediately when pointed at the raw Studio URL

This strongly suggests the remaining attach blocker is the Studio auth boundary, not a deeper incompatibility between the OpenCode client and the Studio-hosted OpenCode server.

In other words:
- raw `studioUrl` is not sufficient
- an auth-aware target that injects the Studio cookies is likely sufficient
- a full extra relay may not be necessary if the workspace target can return the right headers/cookies

## Comparison with Daytona plugin model

The Daytona plugin at `daytonaio/daytona/libs/opencode-plugin` uses `@opencode-ai/plugin` hooks and adds:
- custom tools
- session event handlers
- system prompt transforms
- sandbox/session mapping
- git synchronization logic

This repo currently has only the runtime-side proof:
- a launchable Seqera Studio image running `opencode serve`

It does not yet implement the Daytona-style plugin behavior.

## Highest-value next step

The repo now includes the most likely V1 auth bridge:
1. `src/seqera/studio-auth.ts` reproduces the Seqera authorize flow
2. it mints `connect-auth-*` cookies for the specific Studio URL
3. `src/backends/studio-adaptor.ts` returns those cookies in `target.headers` via a `Cookie` header
4. Studio creation waits for `/experimental/session` to succeed before returning readiness

The next thing to validate is true end-to-end plugin use inside an OpenCode build that actually supports `experimental_workspace.register(...)`.

If static target headers prove insufficient in that real plugin path, the fallback is still:
- introduce a small auth-aware relay that sits between OpenCode and the Studio URL

The proxy experiment and the current implementation both point to auth/header bridging as the key V1 requirement.
