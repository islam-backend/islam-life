import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  icon?: ReactNode
}

const base =
  'inline-flex cursor-pointer items-center gap-2 rounded-[7px] px-3.5 py-2 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50'

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-bg hover:opacity-90',
  secondary: 'border border-border text-text hover:bg-field',
  ghost: 'text-text-muted hover:text-text hover:bg-field',
  danger: 'bg-red text-white hover:opacity-90',
}

export function Button({ variant = 'secondary', icon, className = '', children, ...props }: ButtonProps) {
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props}>
      {icon}
      {children}
    </button>
  )
}
