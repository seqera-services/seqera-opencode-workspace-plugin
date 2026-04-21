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

Local attach to a local OpenCode 1.4.3 server worked well enough to enter the interactive TUI bootstrap path.

However, direct CLI attach to the Studio URL is still blocked.

Observed behavior with `opencode attach https://<studio-url>`:
- current local OpenCode clients (`1.2.24` and downloaded `1.4.3`) both failed before establishing a usable remote session
- the failure looked like:

```text
(x6.data ?? []).toSorted is not a function
```

This happened specifically on remote Studio attach attempts and did not reproduce the same way on local attach.

Separate from that client-side failure, `opencode attach` also has no built-in way to perform the Seqera Studio authorize flow and obtain `connect-auth-*` cookies before speaking to the Studio-hosted OpenCode server.

So the remaining blocker is not the runtime container. It is the client/auth integration path.

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

The next implementation step should be to bridge the OpenCode client to the Studio-hosted server by handling Studio auth explicitly.

Likely directions:
1. have the workspace plugin exchange the Platform bearer token for Studio auth and return the necessary headers/cookies for the remote target, or
2. introduce a small auth-aware relay that sits between OpenCode and the Studio URL

Without solving that auth/client gap, the runtime is proven but the full remote workspace experience is not.
