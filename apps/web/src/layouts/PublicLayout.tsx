import React, { useState } from 'react';
import { Outlet } from 'react-router';
import { LocalizedText } from '../components/i18n/LocalizedText';
import { MouseGlow } from '../components/public/MouseGlow';
import { publicNavigation } from '../components/navigation/navigation-config';
import { applyDocumentLocale, normalizeLocale, type SupportedLocale } from '../i18n/document-locale';

function PublicNavigationLinks() {
  return (
    <ul className="public-navigation-list">
      {publicNavigation.map((item) => (
        <li key={item.to}><a href={item.to}><LocalizedText {...item.label} /></a></li>
      ))}
    </ul>
  );
}

export function PublicLayout() {
  const [locale, setLocale] = useState<SupportedLocale>(() => (
    typeof document === 'undefined' ? 'en' : normalizeLocale(document.documentElement.lang)
  ));

  function changeLocale(nextLocale: SupportedLocale) {
    if (typeof document !== 'undefined') applyDocumentLocale(document, nextLocale);
    setLocale(nextLocale);
  }

  return (
    <div className="public-layout">
      <MouseGlow />
      <header className="public-header">
        <a className="shell-identity" href="/">
          <span className="shell-identity__wordmark" data-locale="ar" lang="ar">منارة</span>
          <span className="shell-identity__wordmark" data-locale="en" lang="en">Manara</span>
        </a>
        <nav aria-label={locale === 'ar' ? 'التنقل العام' : 'Public navigation'} className="public-header__desktop-nav">
          <PublicNavigationLinks />
        </nav>
        <div className="public-header__tools">
          <a className="public-header__action" href="#explore">
            <LocalizedText ar="اطلب الانضمام" en="Request Access" />
          </a>
          <div aria-label={locale === 'ar' ? 'اختيار اللغة' : 'Choose language'} className="public-locale-switch">
            <button aria-pressed={locale === 'ar'} lang="ar" onClick={() => changeLocale('ar')} type="button">العربية</button>
            <button aria-pressed={locale === 'en'} lang="en" onClick={() => changeLocale('en')} type="button">English</button>
          </div>
          <details className="public-mobile-navigation">
            <summary><span aria-hidden="true" className="mobile-navigation__icon" /><LocalizedText ar="القائمة" en="Menu" /></summary>
            <nav aria-label={locale === 'ar' ? 'تنقل الجوال' : 'Mobile navigation'}><PublicNavigationLinks /></nav>
          </details>
        </div>
      </header>
      <main className="public-main" id="main-content" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="public-footer">
        <div>
          <a className="shell-identity" href="/">
            <span className="shell-identity__wordmark" data-locale="ar" lang="ar">منارة</span>
            <span className="shell-identity__wordmark" data-locale="en" lang="en">Manara</span>
          </a>
          <p><LocalizedText ar="منصة للتعليم المؤسسي متعدد السياقات." en="An institutional learning platform for distinct organization contexts." /></p>
        </div>
        <nav aria-label={locale === 'ar' ? 'تنقل التذييل' : 'Footer navigation'}><PublicNavigationLinks /></nav>
        <p className="public-footer__note"><LocalizedText ar="تُعرض القدرات المخطط لها بصفتها توجهاً مستقبلياً بوضوح." en="Planned capabilities are identified clearly as future direction." /></p>
      </footer>
    </div>
  );
}
