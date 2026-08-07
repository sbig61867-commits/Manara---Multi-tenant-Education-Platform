import React, { useRef } from 'react';
import type { NavigationItem } from './navigation-config';
import { NavigationList } from './NavigationList';

interface MobileNavigationProps {
  readonly items: readonly NavigationItem[];
  readonly label: string;
}

export function MobileNavigation({ items, label }: MobileNavigationProps) {
  const disclosure = useRef<HTMLDetailsElement>(null);

  return (
    <details className="mobile-navigation" ref={disclosure}>
      <summary aria-label={`Open navigation: ${label}`}>
        <span aria-hidden="true" className="mobile-navigation__icon" />
        <span>Menu / القائمة</span>
      </summary>
      <nav aria-label={`${label} mobile navigation`}>
        <NavigationList items={items} onNavigate={() => disclosure.current?.removeAttribute('open')} />
      </nav>
    </details>
  );
}
