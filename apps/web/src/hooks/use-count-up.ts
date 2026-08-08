import { useEffect, useRef, useState } from 'react';

export interface CountUpOptions {
  readonly durationMs?: number;
  readonly easing?: (t: number) => number;
}

function defaultEasing(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

export function useCountUp(target: number, { durationMs = 900, easing = defaultEasing }: CountUpOptions = {}): number {
  const [value, setValue] = useState(0);
  const targetRef = useRef(target);
  const startedRef = useRef(false);

  useEffect(() => {
    targetRef.current = target;
  }, [target]);

  useEffect(() => {
    if (!('IntersectionObserver' in window)) {
      setValue(targetRef.current);
      return;
    }

    const node = document.querySelector('[data-count-up]');
    if (!node) {
      setValue(targetRef.current);
      return;
    }

    const run = () => {
      if (startedRef.current) return;
      startedRef.current = true;
      const from = 0;
      const to = targetRef.current;
      const start = performance.now();
      const tick = (now: number) => {
        const progress = Math.min((now - start) / durationMs, 1);
        setValue(from + (to - from) * easing(progress));
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [durationMs, easing]);

  return value;
}
