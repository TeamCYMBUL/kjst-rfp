import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'
import { Link } from 'react-router-dom'

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string
  subtitle?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
      </div>
      {action}
    </div>
  )
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800 ${className}`}>
      {children}
    </div>
  )
}

const btnBase =
  'inline-flex items-center justify-center rounded-lg px-4 py-2 text-sm font-medium transition disabled:opacity-50'
const btnVariants = {
  primary: 'bg-[#1C1008] text-white hover:bg-[#2C1A0D]',
  secondary: 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
}

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: { variant?: keyof typeof btnVariants } & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={`${btnBase} ${btnVariants[variant]} ${className}`} {...props} />
}

export function LinkButton({
  to,
  variant = 'primary',
  children,
}: {
  to: string
  variant?: keyof typeof btnVariants
  children: ReactNode
}) {
  return (
    <Link to={to} className={`${btnBase} ${btnVariants[variant]}`}>
      {children}
    </Link>
  )
}

export function TextField({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function TextArea({
  label,
  hint,
  ...props
}: { label: string; hint?: string } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <textarea
        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  )
}

export function Select({
  label,
  children,
  ...props
}: { label: string } & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <select
        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none"
        {...props}
      >
        {children}
      </select>
    </label>
  )
}

const badgeColors: Record<string, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  opened: 'bg-amber-100 text-amber-700',
  collecting: 'bg-amber-100 text-amber-700',
  submitted: 'bg-emerald-100 text-emerald-700',
  declined: 'bg-red-100 text-red-700',
  closed: 'bg-slate-200 text-slate-700',
  awarded: 'bg-amber-100 text-amber-800',
  passed: 'bg-slate-100 text-slate-400',
  unavailable: 'bg-slate-100 text-slate-400',
}

export function Badge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        badgeColors[status] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {status}
    </span>
  )
}

export function Loading() {
  return <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  )
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-10 text-center dark:border-slate-600 dark:bg-slate-800">
      <p className="text-sm font-medium text-slate-600 dark:text-slate-300">{title}</p>
      {children && <div className="mt-3">{children}</div>}
    </div>
  )
}
