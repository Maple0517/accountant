import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement>

function IconBase({ children, ...props }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height="20"
      viewBox="0 0 24 24"
      width="20"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

export function OverviewIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 13h6V4H4z" />
      <path d="M14 20h6V4h-6z" />
      <path d="M4 20h6v-3H4z" />
    </IconBase>
  )
}

export function TransactionsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 7h16" />
      <path d="M6 4h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z" />
      <path d="M8 13h5" />
      <path d="M8 16h3" />
    </IconBase>
  )
}

export function BudgetsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 21a9 9 0 1 0-9-9" />
      <path d="M12 7v5l3 3" />
      <path d="M3 12h4" />
    </IconBase>
  )
}

export function InsightsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="m7 15 3-4 3 2 4-7" />
    </IconBase>
  )
}

export function AccountsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 10h18" />
      <path d="M5 10V8l7-4 7 4v2" />
      <path d="M6 10v7" />
      <path d="M10 10v7" />
      <path d="M14 10v7" />
      <path d="M18 10v7" />
      <path d="M4 20h16" />
    </IconBase>
  )
}

export function IntegrationsIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8 12h8" />
      <path d="M7 7h.01" />
      <path d="M17 17h.01" />
      <path d="M7 17a5 5 0 0 1 0-10" />
      <path d="M17 7a5 5 0 0 1 0 10" />
    </IconBase>
  )
}
