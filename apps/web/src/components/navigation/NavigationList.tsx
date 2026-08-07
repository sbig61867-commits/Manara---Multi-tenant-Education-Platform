import React from 'react';
import { NavLink } from 'react-router';
import type { NavigationItem } from './navigation-config';

interface NavigationListProps {
  readonly items: readonly NavigationItem[];
  readonly onNavigate?: () => void;
}

export function NavigationList({ items, onNavigate }: NavigationListProps) {
  return (
    <ul className="navigation-list">
      {items.map((item) => (
        <li key={item.to}>
          <NavLink
            className={({ isActive }) => `navigation-link${isActive ? ' navigation-link--active' : ''}`}
            end
            onClick={onNavigate}
            to={item.to}
          >
            <span>{item.label}</span>
            <span aria-hidden="true" className="navigation-link__marker" />
          </NavLink>
        </li>
      ))}
    </ul>
  );
}
