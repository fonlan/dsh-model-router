/**
 * @fonlan/dsh-model-router host half: the virtual model-router provider.
 *
 * Registers one `model-router` LLM adapter that aggregates every configured
 * provider and model (strict model-id merge), routes each request to the
 * model's currently active provider by in-process delegation, keeps the
 * per-model provider order/active config in the entry config of this bundle
 * (dsh >= 0.1.7: the `Config` schema below is the settings document), and
 * serves the fenced JSON API the web settings page calls.
 */
import type { Context } from '@deepseek-ai/cordis'
import { ModelRouterService, RouterConfigSchema } from './server/service.js'
import { registerApiRoutes } from './server/rpc.js'
import type { RouterConfigShape } from './shared/config.js'

export const name = '@fonlan/dsh-model-router'

// The llm service is part of dsh-base (required); the settings service and
// web server are attached opportunistically so the router works in web, CLI,
// and headless profiles alike (headless profiles route by config but expose
// no settings page).
export const inject = ['llm']

// The entry config IS the router document: the settings plane writes it
// (settings page / settings.replace) and a changed config restarts this entry.
export const Config = RouterConfigSchema

export function apply(ctx: Context, config: RouterConfigShape): void {
  const service = new ModelRouterService(ctx, config)

  ctx.effect(() => {
    service.start()
    return () => service.stop()
  }, 'model-router: service')

  // The settings-page API only exists where a web server does.
  ctx.inject(['webServer'], (sctx) => {
    sctx.effect(() => registerApiRoutes(sctx, service), 'model-router: api routes')
  })
}
