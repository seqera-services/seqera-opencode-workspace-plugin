# Seqera OpenCode workspace plugin

This repo is for designing an OpenCode experimental workspace plugin that can launch Seqera-backed remote workspaces.

Current recommendation
- V1: build against Seqera Platform Studios
- V2: add Seqera Scheduler sandboxes once sandbox ingress or a small bridge exists

Why
- OpenCode remote workspaces need a URL target plus optional headers.
- Seqera Studios already return a `studioUrl` and have lifecycle APIs (`create`, `describe`, `start`, `stop`, `delete`).
- Seqera Scheduler sandboxes have better bootstrap primitives (`envVars`, file APIs, exec APIs), but the public schema currently exposes no ingress URL or port-forward API, which makes them a poor direct fit for `target(): { type: "remote", url }` today.

Docs captured in this repo
- `docs/plugin-design.md` — architecture and API mapping
- `docs/initial-plugin-spec.md` — explicit V1 scope, contracts, and acceptance criteria
- `docs/plans/2026-04-18-seqera-opencode-workspace-plugin.md` — implementation plan

Studio runtime scaffold
- `.seqera/` — minimal Seqera Studio image that runs `opencode serve` behind `connect-client`
- This runtime has been Wave-built and launched successfully in the dev Seqera environment.

Important upstream note
- The OpenCode gist and internal control-plane types expect `create(info, env, from?)` for workspace adaptors.
- The current `@opencode-ai/plugin` dev package type snapshot still shows `create(config, from?)`.
- Plan for a local type shim until the public plugin package catches up.
