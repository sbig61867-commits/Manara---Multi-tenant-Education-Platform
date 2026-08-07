import { useId, type ProgressHTMLAttributes, type ReactNode } from 'react';

export interface ProgressProps extends Omit<ProgressHTMLAttributes<HTMLProgressElement>, 'children'> {
  readonly label: ReactNode;
  readonly valueText?: ReactNode;
}

export function Progress({ id, label, max = 100, value, valueText, ...props }: ProgressProps) {
  const generatedId = useId();
  const progressId = id ?? generatedId;
  const displayValue = valueText ?? (typeof value === 'number' ? `${Math.round((value / Number(max)) * 100)}%` : null);
  return (
    <div className="ui-progress">
      <div className="ui-progress__header">
        <label htmlFor={progressId}>{label}</label>
        {displayValue ? <span>{displayValue}</span> : null}
      </div>
      <progress {...props} id={progressId} max={max} value={value} />
    </div>
  );
}
