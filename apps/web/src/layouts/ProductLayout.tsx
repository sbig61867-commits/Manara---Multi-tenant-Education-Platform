import React from 'react';
import { Outlet } from 'react-router';
import { Breadcrumbs } from '../components/navigation/Breadcrumbs';
import { MobileNavigation } from '../components/navigation/MobileNavigation';
import { NavigationList } from '../components/navigation/NavigationList';
import { productNavigation, type ProductRole } from '../components/navigation/navigation-config';

interface ProductLayoutProps {
  readonly role: ProductRole;
}

export function ProductLayout({ role }: ProductLayoutProps) {
  const navigation = productNavigation[role];

  return (
    <div className="product-layout" data-role={role}>
      <aside className="product-sidebar">
        <a className="shell-identity" href="/">
          <span className="shell-identity__wordmark" data-locale="ar" lang="ar">منارة</span>
          <span className="shell-identity__wordmark" data-locale="en" lang="en">Manara</span>
        </a>
        <p className="product-sidebar__context">{navigation.label}</p>
        <nav aria-label={`${navigation.label} navigation`}>
          <NavigationList items={navigation.items} />
        </nav>
      </aside>
      <div className="product-workspace">
        <header className="product-topbar">
          <MobileNavigation items={navigation.items} label={navigation.label} />
          <p dir="auto">{navigation.label}</p>
        </header>
        <div className="product-page-region">
          <Breadcrumbs items={navigation.items} />
          <main className="product-main" id="main-content" tabIndex={-1}>
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
