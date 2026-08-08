import React from 'react';
import { LocalizedText } from '../i18n/LocalizedText';
import type { Metric } from '../../content/public-content';
import { useCountUp } from '../../hooks/use-count-up';

function MetricValue({ value }: { readonly value: number }) {
  const display = useCountUp(value);
  return (
    <span className="hero-metric__value" aria-hidden="true">
      {String(display).padStart(2, '0')}
    </span>
  );
}

export function HeroMetrics({ metrics }: { readonly metrics: readonly Metric[] }) {
  return (
    <dl className="hero-metrics" data-count-up aria-label="Manara in numbers">
      {metrics.map((metric) => (
        <div className="hero-metric" key={metric.label.en}>
          <dt className="visually-hidden"><LocalizedText {...metric.label} /></dt>
          <dd className="hero-metric__body">
            <MetricValue value={metric.value} />
            <span className="hero-metric__label"><LocalizedText {...metric.label} /></span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
