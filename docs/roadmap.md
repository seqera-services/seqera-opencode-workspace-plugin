# Roadmap

Status: post-V1 stabilization notes after the live Seqera Studio create-path fix.

## Current state

The plugin is in a good V1 state for the Studio-backed create flow:
- the plugin registers in OpenCode
- Studio creation works against the live Seqera dev environment
- `sessionId` and `studioUrl` are persisted correctly
- the live harness builds from a clean committed worktree and validates the real create path
- local build, typecheck, and tests are green

This means the current branch is suitable as the baseline V1 implementation.

## What is intentionally not blocking V1

These are useful follow-up items, but they do not block the current working plugin:
- additional UX polish around failures and retries
- further docs cleanup in the design/spec notes
- Scheduler sandbox support
- any broader abstraction beyond the current Studio-first seam

## Near-term follow-ups

### 1. End-to-end attach and replay validation

Goal:
- prove the full OpenCode remote workflow works through the Studio target, not just provisioning and readiness

Why it still matters:
- the live harness currently proves create/readiness and cleanup
- the original V1 acceptance criteria also called out successful remote connection and replay into `/sync/replay`

Likely work:
- validate a real attach/session flow against the Studio-backed target
- confirm `/sync/replay` behaves correctly through the Studio URL and auth bridge
- document the exact success path and any client-version caveats

### 2. Decide whether static cookie/header bridging is sufficient

Goal:
- confirm whether the current `target.headers` approach is enough for all intended OpenCode traffic

Current understanding:
- the major blocker appears to be the Studio auth boundary
- the plugin now performs the Seqera authorize flow and returns Studio cookies via a `Cookie` header
- this may be enough, but the strongest proof will come from successful end-to-end attach/replay behavior

Fallback if needed:
- add a small auth-aware relay/proxy only if static headers are not sufficient in practice

### 3. Finalize runtime auth posture

Question:
- should `OPENCODE_SERVER_PASSWORD` remain optional, or should there be a stronger documented recommendation for when to enable it?

Current recommendation:
- keep it optional by default
- rely on Seqera Studio auth as the main gate
- only enable the extra password layer when a caller explicitly wants defense in depth

### 4. Close out remaining spec questions

The implementation is ahead of some of the earlier design notes.

Follow-up work:
- update docs so the resolved questions are clearly marked as resolved
- narrow the remaining open questions to the ones that still matter after the live create-path validation
- keep the spec aligned with the actual implementation and test harness behavior

## Future work / V2

### Scheduler sandbox backend

Still out of scope for V1.

This becomes relevant if you want:
- better bootstrap primitives
- richer file/exec control than Studios provide
- a second backend option once ingress/port-forwarding is solved cleanly

That work likely needs:
- a separate design pass
- a clean connectivity story for turning a sandbox into an OpenCode `remote` target
- decisions about whether sandbox support should share the Studio-facing plugin contract or live behind a new adaptor path

## Practical next steps

If work resumes later, the most sensible order is:
1. validate real attach + `/sync/replay`
2. decide whether the current cookie/header bridge is sufficient or if a relay is needed
3. tighten the docs/spec to match what is now proven
4. only then consider V2 sandbox exploration
