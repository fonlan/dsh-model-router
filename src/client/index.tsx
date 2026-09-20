/**
 * @fonlan/dsh-model-router client half: the plugin's own Settings page
 * (设置 → 侧栏「模型路由」) plus the model seat that merges the provider
 * switcher into DSH's composer model picker menu.
 *
 * The page registers into the settings.section slot, so it owns one entry in
 * the settings sidebar and renders in the panel content column; the page
 * component itself lives in ./settings-section.
 */
import type { Context } from '@deepseek-ai/cordis'
type ClientContext = Context
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { LOCALE_NS, zh, en } from './locales'
import { makeSettingsSection, type SettingsScopeFace } from './settings-section'
import { registerModelRouterSeat } from './model-seat'

/** The settings namespace this page edits (must match the host half). */
const ROUTER_NS = 'model-router'

/** The settings sidebar entry this page owns (must stay stable). */
const SECTION_ID = 'model-router'

/** Slots face: the settings.section list slot is declared at runtime by the
 *  settings shell (ui-settings-general), which external plugins do not depend
 *  on; the register call below is typed through this local face (erased at
 *  build time). Its inject face binds the model-router settings scope, which
 *  reaches the component as the scope prop. */
interface SectionEntry {
  name: string
  id?: string
  order?: number
  label?: () => string
  locale?: string
  inject?: () => unknown
}

interface Slots {
  inject(name: string, callback: () => unknown): unknown
  register(def: SectionEntry, component: unknown): unknown
}

/** Services required before mounting (provided by the client runtime).
 *  `remote.session` is included like the host ui-model-selection declares it:
 *  the seat's `directoryFor` depends on the namespace, which mounts
 *  asynchronously at startup. */
export const inject = ['slots', 'locale', 'modelDirectories', 'sessions', 'settingsScope', 'connection', 'remote', 'remote.session']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const off = ctx.locale.register(LOCALE_NS, { zh, en })
    return () => off()
  }, 'model-router: dictionaries')

  const t = ctx.locale.bind(LOCALE_NS) as unknown as (key: string) => string
  const SettingsSection = makeSettingsSection(ctx)

  // The page registers on the settings.section list slot under a stable id, so
  // it appears in the settings sidebar's left navigation. The bound
  // model-router settings scope (the same namespace the host half registers)
  // travels through the inject face and reaches the component as scope.
  const services = ctx as unknown as {
    slots: Slots
    settingsScope: { bind(spec: { namespace: string }): SettingsScopeFace }
  }
  const scope = services.settingsScope.bind({ namespace: ROUTER_NS })

  services.slots.inject('settings.section', () =>
    services.slots.register(
      {
        name: 'settings.section',
        id: SECTION_ID,
        order: 300,
        label: () => t('settingsTitle'),
        locale: LOCALE_NS,
        inject: () => ({ scope }),
      },
      SettingsSection,
    ),
  )

  registerModelRouterSeat(ctx)
}
