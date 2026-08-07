import type { HTMLAttributes } from 'react';

export type BeaconNodeMeaning = 'checkpoint' | 'memory' | 'consequence';
export type BeaconNodeState = 'pending' | 'current' | 'complete';

export interface BeaconNodeProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
  readonly meaning?: BeaconNodeMeaning;
  readonly state?: BeaconNodeState;
}

/** Visual companion for a visible checkpoint label; hidden to avoid duplicate announcements. */
export function BeaconNode({ className, meaning = 'checkpoint', state = 'pending', ...props }: BeaconNodeProps) {
  const classes = ['beacon-node', className].filter(Boolean).join(' ');
  return (
    <span
      {...props}
      aria-hidden="true"
      className={classes}
      data-meaning={meaning}
      data-state={state}
    />
  );
}
