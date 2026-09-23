/**
 * Icon resolution contract.
 *
 * Regression guard for the dsh 0.1.7 upgrade: the seat imported the
 * size-suffixed icons (`IconCheckOutline16`, `IconChevronDownOutline14`, …)
 * which 0.1.7 replaced with stroke-weight names (`…OutlineRegular`). A stale
 * name resolves to `undefined` and React #130 drops the whole
 * `conversation.input.model` slot entry — the model seat disappeared from the
 * conversation input. Each icon must resolve to a component on a runtime that
 * ships any of the names, and to the inlined artwork when it ships none.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const EXPORTS = ['CheckIcon', 'ChevronDownIcon', 'ChevronRightIcon', 'WarningIcon'] as const

/** Import the icon module against a given shape of the primitives package. */
async function loadIcons(exports: Record<string, unknown>): Promise<Record<string, unknown>> {
  vi.resetModules()
  vi.doMock('@deepseek-ai/dsh-client-ui-primitives', () => exports)
  return await import('../src/client/icons')
}

afterEach(() => {
  vi.doUnmock('@deepseek-ai/dsh-client-ui-primitives')
  vi.resetModules()
})

describe('seat icons', () => {
  it('prefers the DSH 0.1.7 stroke-weight exports', async () => {
    const regular = {
      IconCheckOutlineRegular: (): null => null,
      IconChevronDownOutlineRegular: (): null => null,
      IconChevronRightOutlineRegular: (): null => null,
      IconWarningOutlineRegular: (): null => null,
    }
    const icons = await loadIcons(regular)
    expect(icons.CheckIcon).toBe(regular.IconCheckOutlineRegular)
    expect(icons.ChevronDownIcon).toBe(regular.IconChevronDownOutlineRegular)
    expect(icons.ChevronRightIcon).toBe(regular.IconChevronRightOutlineRegular)
    expect(icons.WarningIcon).toBe(regular.IconWarningOutlineRegular)
  })

  it('falls back to the legacy size-suffixed exports', async () => {
    const legacy = {
      IconCheckOutline16: (): null => null,
      IconChevronDownOutline14: (): null => null,
      IconChevronRightOutline14: (): null => null,
      IconWarningOutline16: (): null => null,
    }
    const icons = await loadIcons(legacy)
    expect(icons.CheckIcon).toBe(legacy.IconCheckOutline16)
    expect(icons.ChevronRightIcon).toBe(legacy.IconChevronRightOutline14)
  })

  it('always resolves every icon to a component, even with no known export', async () => {
    const icons = await loadIcons({ SomethingElse: (): null => null })
    for (const name of EXPORTS) expect(typeof icons[name], name).toBe('function')
  })

  it('ignores non-component exports under a known name', async () => {
    const icons = await loadIcons({ IconWarningOutlineRegular: 'not-a-component' })
    expect(typeof icons.WarningIcon).toBe('function')
  })
})
