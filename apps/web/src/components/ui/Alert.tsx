import type { HTMLAttributes, ReactNode } from 'react';

export type AlertVariant = 'success' | 'warning' | 'danger' | 'info';

export interface AlertProps extends Omit<HTMLAttributes<HTMLDivElement>, 'role' | 'title'> {
  readonly icon?: ReactNode;
  readonly role?: 'alert' | 'status';
  readonly title: ReactNode;
  readonly variant?: AlertVariant;
}

export function Alert({ children, className, icon, role, title, variant = 'info', ...props }: AlertProps) {
  const classes = ['ui-alert', className].filter(Boolean).join(' ');
  return (
    <div {...props} className={classes} data-variant={variant} role={role}>
      {icon ? (
        <span aria-hidden="true" className="ui-alert__icon">
          {icon}
        </span>
      ) : null}
      <div className="ui-alert__content">
        <strong className="ui-alert__title">{title}</strong>
        {children ? <div className="ui-alert__description">{children}</div> : null}
      </div>
    </div>
  );
}
