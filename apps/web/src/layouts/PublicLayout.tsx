import React from 'react';
import { Outlet } from 'react-router';
import { NavigationList } from '../components/navigation/NavigationList';
import { MobileNavigation } from '../components/navigation/MobileNavigation';
import { publicNavigation } from '../components/navigation/navigation-config';

export function PublicLayout() {
  return (
    <div className="public-layout">
      <header className="public-header">
        <a className="shell-identity" href="/">
          <span className="shell-identity__wordmark" data-locale="ar" lang="ar">منارة</span>
          <span className="shell-identity__wordmark" data-locale="en" lang="en">Manara</span>
        </a>
        <nav aria-label="Public navigation / التنقل العام" className="public-header__desktop-nav">
          <NavigationList items={publicNavigation} />
        </nav>
        <MobileNavigation items={publicNavigation} label="Public / عام" />
      </header>
      <main className="public-main" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
