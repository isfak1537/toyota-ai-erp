// The product mark: a cube (stock, parts) with a small spark (the AI). Colours come from the design tokens.
export function Logo({ size = 32 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <rect width="64" height="64" rx="14" fill="var(--color-logo-tile)" />
      <g fill="none" stroke="var(--color-logo-mark)" strokeWidth="4" strokeLinejoin="round">
        <path d="M32 12 50 22v20L32 52 14 42V22z" />
        <path d="M14 22l18 10 18-10M32 32v20" />
      </g>
      <path d="M50 6l2.2 5.8L58 14l-5.8 2.2L50 22l-2.2-5.8L42 14l5.8-2.2z" fill="var(--color-logo-spark)" />
    </svg>
  )
}
