import React, { type ButtonHTMLAttributes, type ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'danger';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly loading?: boolean;
  readonly loadingLabel?: string;
  readonly startIcon?: ReactNode;
  readonly variant?: ButtonVariant;
}

export function Button({
  children,
  className,
  disabled,
  loading = false,
  loadingLabel = 'Loading',
  startIcon,
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  const classes = ['ui-button', className].filter(Boolean).join(' ');
  return (
    <button
      {...props}
      aria-busy={loading || undefined}
      className={classes}
      data-variant={variant}
      disabled={disabled || loading}
      type={type}
    >
      {loading ? <span aria-hidden="true" className="ui-button__spinner" /> : startIcon}
      <span>{children}</span>
      {loading ? <span className="visually-hidden">{loadingLabel}</span> : null}
    </button>
  );
}
