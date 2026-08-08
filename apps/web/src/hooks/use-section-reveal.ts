import { useEffect } from 'react';

export function useSectionReveal(): void {
  useEffect(() => {
    if (!('IntersectionObserver' in window)) return;

    const elements = [...document.querySelectorAll<HTMLElement>('[data-reveal]')];
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute('data-revealed', 'true');
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.15 },
    );

    document.documentElement.setAttribute('data-reveal-enhanced', 'true');
    for (const element of elements) observer.observe(element);

    return () => {
      observer.disconnect();
      document.documentElement.removeAttribute('data-reveal-enhanced');
    };
  }, []);
}
