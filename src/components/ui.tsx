import type { ReactNode, InputHTMLAttributes, TextareaHTMLAttributes, SelectHTMLAttributes } from 'react'
import { useState } from 'react'
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
  secondary: 'border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-600',
  danger: 'border border-red-200 dark:border-red-800 bg-white dark:bg-slate-700 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20',
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
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
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
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <textarea
        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-slate-400 dark:text-slate-500">{hint}</span>}
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
      <span className="mb-1 block text-sm font-medium text-slate-700 dark:text-slate-300">{label}</span>
      <select
        className="w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 px-3 py-2 text-sm focus:border-[#1C1008] focus:ring-1 focus:ring-[#1C1008] focus:outline-none"
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
  closed: 'bg-emerald-100 text-emerald-700',
  awarded: 'bg-amber-100 text-amber-800',
  passed: 'bg-slate-100 text-slate-400',
  unavailable: 'bg-slate-100 text-slate-400',
}

export function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
        badgeColors[status] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {label ?? status}
    </span>
  )
}

export function Loading() {
  return <div className="py-12 text-center text-sm text-slate-400 dark:text-slate-500">Loading…</div>
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-700 dark:text-red-400">
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

// A small, dismissible "how to use this page" tip. Each unique `id` remembers its
// own dismissal in localStorage, so it reads as a helpful hint, not clutter — once
// someone clicks it away it stays gone on that browser.
export function PageTip({
  id,
  title = 'Quick tips',
  children,
  className = '',
}: {
  id: string
  title?: string
  children: ReactNode
  className?: string
}) {
  const storageKey = `kjst_tip_${id}`
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(storageKey) === '1'
    } catch {
      return false
    }
  })
  if (dismissed) return null
  const dismiss = () => {
    try {
      localStorage.setItem(storageKey, '1')
    } catch {
      /* private mode / storage disabled — just hide for this view */
    }
    setDismissed(true)
  }
  return (
    <div
      className={`relative rounded-xl border border-amber-200 dark:border-amber-800/60 bg-amber-50 dark:bg-amber-900/15 px-5 py-4 pr-9 text-sm text-amber-900 dark:text-amber-100 ${className}`}
    >
      <button
        onClick={dismiss}
        title="Got it — hide this tip"
        aria-label="Dismiss tip"
        className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-md text-base leading-none text-amber-500 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40 transition-colors"
      >
        &times;
      </button>
      <p className="mb-2 flex items-center gap-2 font-semibold">
        <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 18h6" />
          <path d="M10 22h4" />
          <path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1V17h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z" />
        </svg>
        {title}
      </p>
      <div className="space-y-1.5 text-amber-800/90 dark:text-amber-100/80 leading-relaxed">{children}</div>
    </div>
  )
}
