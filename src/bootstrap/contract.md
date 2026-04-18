# Seqera Studio bootstrap contract

The Studio image or tool is expected to:

1. receive OpenCode environment variables
2. materialize the repository at a writable path
3. write `.git/opencode` with the OpenCode project id
4. start `opencode serve`
5. expose the server behind the Studio URL that Seqera returns

This contract is intentionally minimal for the initial scaffold. The exact port, health check path, and auth model are still open questions and must be validated before implementation hardens.
