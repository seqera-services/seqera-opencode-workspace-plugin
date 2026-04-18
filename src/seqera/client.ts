import type { SeqeraPluginConfig } from '../types.js'

export type FetchFn = typeof globalThis.fetch

export interface SeqeraClient {
  config: SeqeraPluginConfig
  fetchJson<T>(path: string, init?: RequestInit): Promise<T>
  fetchVoid(path: string, init?: RequestInit): Promise<void>
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.text()
    return text ? ` — ${text}` : ''
  } catch {
    return ''
  }
}

export function createSeqeraClient(
  config: SeqeraPluginConfig,
  fetchImpl: FetchFn = globalThis.fetch,
): SeqeraClient {
  async function doFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const response = await fetchImpl(buildUrl(config.apiBaseUrl, path), {
      ...init,
      headers: {
        authorization: `Bearer ${config.apiToken}`,
        accept: 'application/json',
        'content-type': 'application/json',
        ...(init.headers as Record<string, string> | undefined),
      },
    })

    if (!response.ok) {
      const body = await readErrorBody(response)
      throw new Error(
        `Seqera API ${response.status} ${response.statusText}${body}`,
      )
    }

    return response
  }

  return {
    config,

    async fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
      const response = await doFetch(path, init)
      return (await response.json()) as T
    },

    async fetchVoid(path: string, init?: RequestInit): Promise<void> {
      await doFetch(path, init)
    },
  }
}
