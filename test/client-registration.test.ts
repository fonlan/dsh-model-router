/**
 * Client-half registration contract.
 *
 * Regression guard for the dsh 0.1.7 upgrade: the settings page used to be
 * registered inside `ctx.inject(['settingsScope'], …)`, and 0.1.7 dropped that
 * client service — so the callback never ran and the 模型路由 page silently
 * disappeared from Settings. The page must register unconditionally, on a
 * client runtime that offers no settings service at all.
 */
import { describe, expect, it, vi } from 'vitest'
import { apply, inject } from '../src/client/index'

/**
 * The client half imports `@deepseek-ai/dsh-client-ui-primitives` for its atoms
 * (Toast, icons). As of dsh 0.2.0-rc.1 that package publishes the markdown /
 * shiki libraries its bundle imports as devDependencies only, so the real
 * module cannot be loaded in an isolated plugin install (pnpm links no runtime
 * deps for it); this suite only asserts slot registration, so the atoms are
 * stubbed exactly like test/icons.test.ts does. `vi.mock` is hoisted above the
 * imports above, so the stub applies to the whole graph.
 */
vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({}))

interface Registered {
  name: string
  id?: string
  priority?: number
}

/** Services the dsh 0.1.7 client runtime provides to this plugin (from dsh.client.inject). */
const PROVIDED = new Set([
  'slots',
  'locale',
  'modelDirectories',
  'sessions',
  'connection',
  'remote',
  'remote.session',
])

/** Minimal cordis-like client context: no settings/settingsScope service anywhere. */
function harness(): { ctx: unknown; registered: Registered[]; injectRequests: string[][] } {
  const registered: Registered[] = []
  const injectRequests: string[][] = []
  const ctx = {
    effect: (factory: () => unknown): void => {
      factory()
    },
    locale: {
      register: () => () => {},
      bind: () => (key: string) => key,
      subscribe: () => () => {},
      getLocale: () => ({ revision: 0 }),
    },
    slots: {
      inject: (_name: string, callback: () => unknown): void => {
        callback()
      },
      register: (def: Registered): (() => void) => {
        registered.push(def)
        return () => {}
      },
    },
    inject: (names: string[], callback: (scope: unknown) => void): void => {
      injectRequests.push(names)
      if (names.every(name => PROVIDED.has(name))) callback(ctx)
    },
  }
  return { ctx, registered, injectRequests }
}

describe('client registration', () => {
  it('declares only services the 0.1.7 client runtime provides', () => {
    expect(inject).toContain('slots')
    expect(inject).toContain('locale')
    // settingsScope was removed in dsh 0.1.7; requiring it gates the whole entry.
    expect(inject).not.toContain('settingsScope')
  })

  it('registers the settings section without any settings service', () => {
    const { ctx, registered } = harness()
    apply(ctx as never)

    const section = registered.find(entry => entry.name === 'settings.section')
    expect(section).toBeDefined()
    expect(section?.id).toBe('model-router')
  })

  it('registers the composer model seat as well', () => {
    const { ctx, registered, injectRequests } = harness()
    apply(ctx as never)

    expect(injectRequests).toContainEqual(['slots', 'modelDirectories', 'remote.session'])
    expect(registered.some(entry => entry.name === 'conversation.input.model')).toBe(true)
  })
})
