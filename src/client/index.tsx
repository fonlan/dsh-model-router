/**
 * @fonlan/dsh-model-router client half: the Model Router settings page plus
 * a quick provider switcher beside DSH's composer model selector.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-model-selection/client'
import { LOCALE_NS, zh, en } from './locales'
import { makeSettingsSection } from './settings-section'
import { registerRouteSwitcher } from './route-switcher'

/** Services required before mounting (provided by the client runtime). */
export const inject = ['slots', 'locale', 'modelDirectories']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  const t = ctx.locale.bind(LOCALE_NS)
  ctx.effect(() => {
    const off = ctx.locale.register(LOCALE_NS, { zh, en })
    return () => off()
  }, 'model-router: dictionaries')

  const SettingsSection = makeSettingsSection(ctx)
  ctx.slots.inject('settings.section', () =>
    ctx.slots.register({
      name: 'settings.section',
      id: 'model-router',
      order: 300,
      label: () => t('settingsTitle'),
      locale: LOCALE_NS,
    }, SettingsSection as never),
  )

  registerRouteSwitcher(ctx)
}
