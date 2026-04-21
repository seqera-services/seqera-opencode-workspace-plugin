import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mintStudioAuthHeaders } from './studio-auth.ts'

describe('mintStudioAuthHeaders', () => {
  it('follows the Studio authorize flow and returns a Cookie header', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = []
    let studioProbeCount = 0
    const fetchImpl: typeof globalThis.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      calls.push({ url, init })

      if (url === 'https://studio.test/experimental/session' && studioProbeCount++ === 0) {
        return new Response(null, {
          status: 302,
          headers: { location: 'https://cloud.dev-seqera.io/api/authorize?nonce=abc' },
        })
      }

      if (url === 'https://cloud.dev-seqera.io/api/authorize?nonce=abc') {
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer tok-seqera')
        return new Response(null, {
          status: 302,
          headers: [
            ['location', 'https://cloud.dev-seqera.io/api/authorize/continue?nonce=abc'],
            ['set-cookie', 'authorize-seed=seed123; Path=/; Secure; HttpOnly'],
          ],
        })
      }

      if (url === 'https://cloud.dev-seqera.io/api/authorize/continue?nonce=abc') {
        assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer tok-seqera')
        assert.equal(new Headers(init?.headers).get('cookie'), 'authorize-seed=seed123')
        return new Response(null, {
          status: 302,
          headers: { location: 'https://connect.connect.cloud.dev-seqera.io/connect_auth_callback?state=xyz&code=123' },
        })
      }

      if (url === 'https://connect.connect.cloud.dev-seqera.io/connect_auth_callback?state=xyz&code=123') {
        assert.equal(new Headers(init?.headers).get('cookie'), null)
        return new Response(null, {
          status: 302,
          headers: { location: 'https://studio.test/experimental/session?connect-exch-token=tok' },
        })
      }

      if (url === 'https://studio.test/experimental/session?connect-exch-token=tok') {
        assert.equal(new Headers(init?.headers).get('cookie'), null)
        return new Response(null, {
          status: 302,
          headers: [
            ['location', '/experimental/session'],
            ['set-cookie', 'connect-auth-sub=184; Path=/; HttpOnly; Secure; SameSite=None'],
            ['set-cookie', 'connect-auth-tokens=abc123; Path=/; HttpOnly; Secure; SameSite=None'],
          ],
        })
      }

      if (url === 'https://studio.test/experimental/session') {
        const cookieHeader = new Headers(init?.headers).get('cookie')
        assert.equal(cookieHeader, 'connect-auth-sub=184; connect-auth-tokens=abc123')
        return new Response('[]', {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      }

      throw new Error(`unexpected fetch ${url}`)
    }

    const headers = await mintStudioAuthHeaders({
      studioUrl: 'https://studio.test',
      apiToken: 'tok-seqera',
      fetchImpl,
    })

    assert.deepStrictEqual(headers, {
      Cookie: 'connect-auth-sub=184; connect-auth-tokens=abc123',
    })
    assert.equal(calls.length, 6)
  })

  it('rejects unexpected authorize origins before sending the bearer token', async () => {
    let fetchCount = 0
    const fetchImpl: typeof globalThis.fetch = async () => {
      fetchCount++
      return new Response(null, {
        status: 302,
        headers: { location: 'https://evil.example.com/authorize?nonce=abc' },
      })
    }

    await assert.rejects(
      () => mintStudioAuthHeaders({
        studioUrl: 'https://studio.test',
        apiToken: 'tok-seqera',
        fetchImpl,
        allowedAuthorizeOrigins: ['https://cloud.dev-seqera.io'],
      }),
      { message: /unexpected studio authorize origin/i },
    )
    assert.equal(fetchCount, 1)
  })

  it('returns undefined when the probe is already directly reachable', async () => {
    const fetchImpl: typeof globalThis.fetch = async () =>
      new Response('[]', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })

    const headers = await mintStudioAuthHeaders({
      studioUrl: 'https://studio.test',
      apiToken: 'tok-seqera',
      fetchImpl,
    })

    assert.equal(headers, undefined)
  })
})
