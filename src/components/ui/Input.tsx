import type { InputHTMLAttributes, SelectHTMLAttributes, ReactNode } from 'react'

export function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />
}

export function Field({
  label,
  children,
  hint,
  className = '',
}: {
  label: string
  children: ReactNode
  hint?: ReactNode
  className?: string
}) {
  return (
    <label className={`input-group ${className}`.trim()}>
      <span className="input-label">{label}</span>
      {children}
      {hint && <span className="input-hint">{hint}</span>}
    </label>
  )
}

export function Select({ className = '', ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`input select ${className}`.trim()} {...props} />
}
