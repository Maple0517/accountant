import type { ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react'
import Link from 'next/link'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
type ButtonSize = 'sm' | 'md' | 'lg'

type CommonProps = {
  children: ReactNode
  variant?: ButtonVariant
  size?: ButtonSize
  className?: string
}

export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  className = '',
  ...props
}: CommonProps & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`btn btn-${variant} btn-${size} ${className}`.trim()} {...props}>
      {children}
    </button>
  )
}

export function ButtonLink({
  children,
  variant = 'secondary',
  size = 'md',
  className = '',
  href,
  ...props
}: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <Link className={`btn btn-${variant} btn-${size} ${className}`.trim()} href={href} {...props}>
      {children}
    </Link>
  )
}
