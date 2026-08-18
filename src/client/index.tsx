/**
 * @fonlan/dsh-model-router client half: the plugin's own Settings Card
 * (设置 → 插件 → 插件配置 → 模型路由) plus a quick provider switcher beside
 * DSH's composer model selector.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { LOCALE_NS, zh, en } from './locales'
import { makeSettingsCard, type SettingsScopeFace } from './settings-card'
import { registerRouteSwitcher } from './route-switcher'

/** The settings namespace this card edits (must match the host half). */
const ROUTER_NS = 'model-router'

/** Slots face: the keyed `settings.plugin.item` declaration ships with the web
 *  app's ui-settings-plugins package, which external plugins do not depend on;
 *  the register call below is typed through this local face (erased at build). */
interface Slots {
  inject(name: string, callback: () => unknown): unknown
  register(def: { name: string; key: string; inject?: () => unknown }, component: unknown): unknown
}

/** Services required before mounting (provided by the client runtime). */
export const inject = ['slots', 'locale', 'modelDirectories', 'sessions', 'settingsScope', 'connection', 'remote']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const off = ctx.locale.register(LOCALE_NS, { zh, en })
    return () => off()
  }, 'model-router: dictionaries')

  const SettingsCard = makeSettingsCard(ctx)

  // The card registers on the `settings.plugin.item` slot keyed by the
  // `model-router` settings namespace (the same string the host half
  // registers), so it appears inside 设置 → 插件 → 插件配置, paired with the
  // namespace by the tab.
  const services = ctx as unknown as {
    slots: Slots
    settingsScope: { bind(spec: { namespace: string }): SettingsScopeFace }
  }
  const scope = services.settingsScope.bind({ namespace: ROUTER_NS })

  services.slots.inject('settings.plugin.item', () =>
    services.slots.register(
      {
        name: 'settings.plugin.item',
        key: ROUTER_NS,
        inject: () => ({ scope }),
      },
      SettingsCard,
    ),
  )

  registerRouteSwitcher(ctx)
}
