import React, { type HTMLAttributes, type ReactNode } from 'react';

export type BeaconRailPurpose = 'hierarchy' | 'progress' | 'relationship';

export interface BeaconRailProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children?: ReactNode;
  readonly orientation?: 'horizontal' | 'vertical';
  readonly purpose: BeaconRailPurpose;
}

/** A visual path that accompanies visible hierarchy, progress, or relationship content. */
export function BeaconRail({
  children,
  className,
  orientation = 'vertical',
  purpose,
  ...props
}: BeaconRailProps) {
  const classes = ['beacon-rail', className].filter(Boolean).join(' ');
  return (
    <span
      {...props}
      aria-hidden="true"
      className={classes}
      data-orientation={orientation}
      data-purpose={purpose}
    >
      {children}
    </span>
  );
}
