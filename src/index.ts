/**
 * @fonlan/dsh-model-router host half: the virtual model-router provider.
 *
 * Registers one `model-router` LLM adapter that aggregates every configured
 * provider and model (strict model-id merge), routes each request to the
 * model's currently active provider by in-process delegation, persists the
 * per-model provider order/active config in the `model-router` settings
 * namespace, and serves the fenced JSON API the web settings page calls.
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ModelRouterService } from './server/service.js'
import { registerApiRoutes } from './server/rpc.js'

export const name = '@fonlan/dsh-model-router'

// The llm service is part of dsh-base (required); the settings service and
// web server are attached opportunistically so the router works in web, CLI,
// and headless profiles alike (headless profiles route by config but expose
// no settings page).
export const inject = ['llm']

export const Config = z.object({})

export function apply(ctx: Context): void {
  const service = new ModelRouterService(ctx)

  ctx.effect(() => {
    service.start()
    return () => service.stop()
  }, 'model-router: service')

  // The settings-page API only exists where a web server does.
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => registerApiRoutes(sctx, service), 'model-router: api routes')
  })
}
