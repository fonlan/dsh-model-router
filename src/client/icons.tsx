import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'

/** Props every shell icon accepts: square edge in px, color rides currentColor. */
export interface IconProps {
  size?: number
  className?: string
}

/** One shell icon component. */
export type IconComponent = (props: IconProps) => JSX.Element

/** The runtime export table, read by capability instead of by one hard-coded name. */
const table = primitives as unknown as Record<string, IconComponent | undefined>

/** First name the runtime actually provides (a missing export is `undefined`). */
function firstDefined(...names: string[]): IconComponent | undefined {
  for (const name of names) {
    let candidate: IconComponent | undefined
    try {
      candidate = table[name]
    } catch {
      // Some module namespaces reject unknown names instead of yielding
      // `undefined`; a rename must never throw on its way to the fallback.
      continue
    }
    if (typeof candidate === 'function') return candidate
  }
  return undefined
}

/** One-path stroked glyph fallback (16×16 viewBox — the 0.1.7 artwork). */
function glyph(path: string, defaultSize: number): IconComponent {
  return function Glyph({ size = defaultSize, className }: IconProps): JSX.Element {
    return (
      <svg
        width={size}
        height={size}
        className={className}
        viewBox="0 0 16 16"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        strokeWidth={1}
      >
        <path d={path} stroke="currentColor" />
      </svg>
    )
  }
}

/** Warning circle fallback (the 0.1.7 artwork: ring, stem, dot). */
function WarningFallback({ size = 16, className }: IconProps): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      className={className}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      strokeWidth={1}
    >
      <path d="M8 14.5C11.5899 14.5 14.5 11.5899 14.5 8C14.5 4.41015 11.5899 1.5 8 1.5C4.41015 1.5 1.5 4.41015 1.5 8C1.5 11.5899 4.41015 14.5 8 14.5Z" stroke="currentColor" />
      <path d="M8 4.29199V9.79199" stroke="currentColor" />
      <path d="M8 10.708V11.708" stroke="currentColor" />
    </svg>
  )
}

/**
 * Shell icons used by the model seat.
 *
 * DSH 0.1.7 renamed every size-suffixed icon export (`IconCheckOutline16`,
 * `IconChevronDownOutline14`, …) into stroke-weight variants (`…OutlineRegular`
 * 1px / `…OutlineMedium` 1.3px). A stale named import resolves to `undefined`
 * and React then throws "Element type is invalid" while rendering the slot
 * entry — the whole seat is dropped from the conversation input instead of
 * degrading (this is exactly what the 0.1.7 upgrade did to this plugin).
 * Resolve the names at runtime, newest first, so the next rename lands on
 * another shipped variant or on the inlined artwork below.
 */
export const CheckIcon: IconComponent =
  firstDefined('IconCheckOutlineRegular', 'IconCheckOutlineMedium', 'IconCheckOutline16')
  ?? glyph('M2.25 8.5L5.49732 11.7473C5.90519 12.1552 6.57263 12.1344 6.95426 11.7018L13.75 4', 16)

export const ChevronDownIcon: IconComponent =
  firstDefined('IconChevronDownOutlineRegular', 'IconChevronDownOutlineMedium', 'IconChevronDownOutline14')
  ?? glyph('M4 6L7.29289 9.29289C7.68342 9.68342 8.31658 9.68342 8.70711 9.29289L12 6', 14)

export const ChevronRightIcon: IconComponent =
  firstDefined('IconChevronRightOutlineRegular', 'IconChevronRightOutlineMedium', 'IconChevronRightOutline14')
  ?? glyph('M6 12L9.29289 8.70711C9.68342 8.31658 9.68342 7.68342 9.29289 7.29289L6 4', 14)

export const WarningIcon: IconComponent =
  firstDefined('IconWarningOutlineRegular', 'IconWarningOutlineMedium', 'IconWarningOutline16')
  ?? WarningFallback
