import type { SeqeraPluginConfig } from '../types.js'

export interface SeqeraClient {
  config: SeqeraPluginConfig
  fetchJson<T>(path: string, init?: RequestInit): Promise<T>
}

function buildUrl(baseUrl: string, path: string): string {
  return new URL(path, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString()
}

export function createSeqeraClient(config: SeqeraPluginConfig): SeqeraClient {
  return {
    config,
    async fetchJson<T>(path: string, init: RequestInit = {}) {
      const response = await fetch(buildUrl(config.apiBaseUrl, path), {
        ...init,
        headers: {
          authorization: `Bearer ${config.apiToken}`,
          accept: 'application/json',
          'content-type': 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      })

      if (!response.ok) {
        throw new Error(`Seqera API request failed: ${response.status} ${response.statusText}`)
      }

      return (await response.json()) as T
    },
  }
}
