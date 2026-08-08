import type { HTMLAttributes } from 'react';

export type RegistrationContext = 'certificate' | 'coordinate' | 'record';

export interface RegistrationMarkProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly context: RegistrationContext;
}

/** Marks the corner of a bounded institutional record; never a logo or free decoration. */
export function RegistrationMark({ className, context, ...props }: RegistrationMarkProps) {
  const classes = ['registration-mark', className].filter(Boolean).join(' ');
  return <span {...props} aria-hidden="true" className={classes} data-context={context} />;
}
