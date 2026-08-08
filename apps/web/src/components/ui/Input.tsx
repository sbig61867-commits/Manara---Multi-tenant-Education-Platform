import React, { type InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  readonly invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  const classes = ['ui-input', className].filter(Boolean).join(' ');
  return <input {...props} aria-invalid={invalid || undefined} className={classes} />;
}
