/**
 * Fenced JSON API under /plugins/@fonlan/dsh-model-router/api/<method> for the
 * web settings page. Same browser-trust fence as the /api gateway and the
 * task-kanban plugin: loopback Host-header or configured trustedHosts,
 * same-origin browser markers.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { ModelRouterService } from './service.js'

const API_PREFIX = '/plugins/@fonlan/dsh-model-router/api'

// ── browser-trust fence (mirrors dsh-client-connection's api-request-trust) ──

function header(headers: IncomingMessage['headers'], name: string): string | undefined {
  const value = headers[name]
  return typeof value === 'string' ? value : undefined
}

function isLoopbackHostname(hostname: string): boolean {
  if (hostname === 'localhost' || hostname === '[::1]') return true
  const parts = hostname.split('.')
  return parts.length === 4 && parts[0] === '127' && parts.every(p => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

function isTrustedApiRequest(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = header(req.headers, 'host')
  if (host === undefined) return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (!isLoopbackHostname(hostUrl.hostname) && !trustedHosts.includes(hostUrl.host) && !trustedHosts.includes(hostUrl.hostname)) {
    return false
  }
  if (header(req.headers, 'sec-fetch-site') === 'cross-site') return false
  const origin = header(req.headers, 'origin')
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function trustedHostsOf(ctx: Context): string[] {
  for (const entry of ctx.get('loader')?.entries?.() ?? []) {
    if (entry.options?.name === 'connection') {
      const config = entry.options.config as { trustedHosts?: string[] } | undefined
      return config?.trustedHosts ?? []
    }
  }
  return []
}

// ── wire helpers ────────────────────────────────────────────────────────────

function writeJson(res: ServerResponse, body: unknown): void {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function writeError(res: ServerResponse, code: string, message: string, status = 400): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ ok: false, error: { code, message } }))
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.trim() === '') return {}
  try {
    const parsed = JSON.parse(raw) as unknown
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ── routes ──────────────────────────────────────────────────────────────────

export function registerApiRoutes(ctx: Context, service: ModelRouterService): () => void {
  const fence = (req: IncomingMessage): boolean => isTrustedApiRequest(req, trustedHostsOf(ctx))
  const disposers: Array<() => void> = []

  const route = (name: string, handler: (payload: Record<string, unknown>) => Promise<unknown>): void => {
    disposers.push(ctx.webServer.register({
      kind: 'prefix',
      path: `${API_PREFIX}/${name}`,
      handler: async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
        if (!fence(req)) {
          writeError(res, 'forbidden', 'forbidden', 403)
          return
        }
        if (req.method !== 'POST' && req.method !== 'GET') {
          writeError(res, 'method', 'method not allowed', 405)
          return
        }
        const payload = await readJsonBody(req)
        try {
          const value = await handler(payload)
          writeJson(res, { ok: true, value })
        } catch (error) {
          writeError(res, 'error', error instanceof Error ? error.message : String(error))
        }
      },
    }))
  }

  route('state', async () => service.state())

  route('switch-active', async (p) => {
    const modelId = requireString(p.modelId, 'modelId')
    const providerId = requireString(p.providerId, 'providerId')
    await service.switchActive(modelId, providerId)
    return service.state()
  })

  route('reorder', async (p) => {
    const modelId = requireString(p.modelId, 'modelId')
    if (!Array.isArray(p.order) || !p.order.every((id): id is string => typeof id === 'string')) {
      throw new Error('order 必须是提供商 id 数组')
    }
    await service.reorder(modelId, p.order)
    return service.state()
  })

  route('refresh', async () => {
    await service.refreshAndReconcile()
    return service.state()
  })

  route('set-show-quick-switch', async (p) => {
    if (typeof p.value !== 'boolean') {
      throw new Error('value 必须是布尔值')
    }
    await service.setShowQuickSwitch(p.value)
    return service.state()
  })

  route('set-ignore-model-id-prefix', async (p) => {
    if (typeof p.value !== 'boolean') {
      throw new Error('value 必须是布尔值')
    }
    await service.setIgnoreModelIdPrefix(p.value)
    return service.state()
  })

  return () => {
    for (const dispose of disposers) dispose()
  }
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${name} 不能为空`)
  }
  return value
}
