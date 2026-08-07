import React from 'react';
import { Link, useLocation } from 'react-router';
import type { NavigationItem } from './navigation-config';

interface BreadcrumbsProps {
  readonly items: readonly NavigationItem[];
}

export function Breadcrumbs({ items }: BreadcrumbsProps) {
  const { pathname } = useLocation();
  const current = [...items].sort((a, b) => b.to.length - a.to.length).find((item) =>
    item.to === pathname || (item.to !== '/' && pathname.startsWith(`${item.to}/`)),
  );
  const root = items[0];

  return (
    <nav aria-label="Breadcrumb / مسار التنقل" className="breadcrumbs">
      <ol>
        {current && current.to !== root?.to ? (
          <li>
            <Link to={root?.to ?? '/'}>{root?.shortLabel ?? 'Home'}</Link>
          </li>
        ) : null}
        <li aria-current="page">{current?.shortLabel ?? 'Workspace'}</li>
      </ol>
    </nav>
  );
}
