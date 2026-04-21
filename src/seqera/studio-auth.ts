import type { FetchFn } from './client.js'

export interface MintStudioAuthHeadersInput {
  studioUrl: string
  apiToken: string
  fetchImpl?: FetchFn
  probePath?: string
  allowedAuthorizeOrigins?: string[]
}

type StoredCookie = {
  name: string
  value: string
  domain: string
  path: string
  secure: boolean
  hostOnly: boolean
}

const DEFAULT_PROBE_PATH = '/experimental/session'
const MAX_REDIRECT_STEPS = 8

function isRedirect(status: number): boolean {
  return status >= 300 && status < 400
}

function requireLocation(response: Response, currentUrl: string): string {
  const location = response.headers.get('location')
  if (!location) {
    throw new Error(`Studio auth flow expected redirect location from ${currentUrl}`)
  }
  return new URL(location, currentUrl).toString()
}

function getSetCookieValues(headers: Headers): string[] {
  const withGetSetCookie = headers as Headers & { getSetCookie?: () => string[] }
  if (typeof withGetSetCookie.getSetCookie === 'function') {
    return withGetSetCookie.getSetCookie()
  }

  const combined = headers.get('set-cookie')
  if (!combined) return []
  return combined.split(/, (?=[^;,]+=)/g)
}

function defaultCookiePath(url: URL): string {
  if (!url.pathname || !url.pathname.startsWith('/')) return '/'
  const lastSlash = url.pathname.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return url.pathname.slice(0, lastSlash)
}

function parseSetCookie(rawCookie: string, responseUrl: string): StoredCookie | undefined {
  const response = new URL(responseUrl)
  const parts = rawCookie.split(';').map((part) => part.trim()).filter(Boolean)
  const pair = parts.shift()
  if (!pair) return undefined
  const separator = pair.indexOf('=')
  if (separator <= 0) return undefined

  let domain = response.hostname.toLowerCase()
  let path = defaultCookiePath(response)
  let secure = response.protocol === 'https:'
  let hostOnly = true

  for (const attribute of parts) {
    const [rawName, ...rawValueParts] = attribute.split('=')
    const name = rawName.toLowerCase()
    const value = rawValueParts.join('=')
    if (name === 'domain' && value) {
      domain = value.replace(/^\./, '').toLowerCase()
      hostOnly = false
    } else if (name === 'path' && value.startsWith('/')) {
      path = value
    } else if (name === 'secure') {
      secure = true
    }
  }

  return {
    name: pair.slice(0, separator),
    value: pair.slice(separator + 1),
    domain,
    path,
    secure,
    hostOnly,
  }
}

function upsertCookie(cookieJar: StoredCookie[], cookie: StoredCookie): void {
  const index = cookieJar.findIndex((item) =>
    item.name === cookie.name &&
    item.domain === cookie.domain &&
    item.path === cookie.path,
  )
  if (index >= 0) {
    cookieJar[index] = cookie
    return
  }
  cookieJar.push(cookie)
}

function appendCookies(cookieJar: StoredCookie[], headers: Headers, responseUrl: string): void {
  for (const rawCookie of getSetCookieValues(headers)) {
    const parsed = parseSetCookie(rawCookie, responseUrl)
    if (!parsed) continue
    upsertCookie(cookieJar, parsed)
  }
}

function domainMatches(hostname: string, cookie: StoredCookie): boolean {
  const host = hostname.toLowerCase()
  if (cookie.hostOnly) return host === cookie.domain
  return host === cookie.domain || host.endsWith(`.${cookie.domain}`)
}

function pathMatches(pathname: string, cookie: StoredCookie): boolean {
  return pathname === cookie.path || pathname.startsWith(`${cookie.path}/`) || cookie.path === '/'
}

function buildCookieHeader(urlString: string, cookieJar: StoredCookie[]): string | undefined {
  const url = new URL(urlString)
  const pairs = cookieJar
    .filter((cookie) => {
      if (cookie.secure && url.protocol !== 'https:') return false
      if (!domainMatches(url.hostname, cookie)) return false
      if (!pathMatches(url.pathname || '/', cookie)) return false
      return true
    })
    .map((cookie) => `${cookie.name}=${cookie.value}`)

  if (pairs.length === 0) return undefined
  return pairs.join('; ')
}

function buildHeaders(input: { acceptJson?: boolean; apiToken?: string; cookieHeader?: string }): Headers {
  const headers = new Headers()
  if (input.acceptJson) headers.set('accept', 'application/json')
  if (input.apiToken) headers.set('authorization', `Bearer ${input.apiToken}`)
  if (input.cookieHeader) headers.set('cookie', input.cookieHeader)
  return headers
}

async function fetchManual(
  fetchImpl: FetchFn,
  url: string,
  init: { apiToken?: string; cookieHeader?: string; acceptJson?: boolean },
): Promise<Response> {
  return fetchImpl(url, {
    method: 'GET',
    redirect: 'manual',
    headers: buildHeaders(init),
  })
}

export async function mintStudioAuthHeaders(input: MintStudioAuthHeadersInput): Promise<Record<string, string> | undefined> {
  const fetchImpl = input.fetchImpl ?? globalThis.fetch
  const probeUrl = new URL(input.probePath ?? DEFAULT_PROBE_PATH, input.studioUrl).toString()
  const cookieJar: StoredCookie[] = []

  let response = await fetchManual(fetchImpl, probeUrl, { acceptJson: true })
  appendCookies(cookieJar, response.headers, probeUrl)
  if (response.ok) {
    return undefined
  }
  if (!isRedirect(response.status)) {
    throw new Error(`Studio auth flow expected redirect from ${probeUrl}, got ${response.status}`)
  }

  let nextUrl = requireLocation(response, probeUrl)
  const allowedAuthorizeOrigins = new Set(input.allowedAuthorizeOrigins ?? [new URL(nextUrl).origin])
  if (!allowedAuthorizeOrigins.has(new URL(nextUrl).origin)) {
    throw new Error(`Unexpected studio authorize origin for ${input.studioUrl}: ${new URL(nextUrl).origin}`)
  }

  for (let step = 0; step < MAX_REDIRECT_STEPS; step++) {
    const nextOrigin = new URL(nextUrl).origin
    response = await fetchManual(fetchImpl, nextUrl, {
      apiToken: allowedAuthorizeOrigins.has(nextOrigin) ? input.apiToken : undefined,
      acceptJson: true,
      cookieHeader: buildCookieHeader(nextUrl, cookieJar),
    })
    appendCookies(cookieJar, response.headers, nextUrl)

    if (response.ok) {
      const cookieHeader = buildCookieHeader(probeUrl, cookieJar)
      return cookieHeader ? { Cookie: cookieHeader } : undefined
    }

    if (!isRedirect(response.status)) {
      throw new Error(`Studio auth flow expected redirect or success from ${nextUrl}, got ${response.status}`)
    }

    nextUrl = requireLocation(response, nextUrl)
  }

  throw new Error(`Studio auth flow exceeded ${MAX_REDIRECT_STEPS} redirects for ${input.studioUrl}`)
}
