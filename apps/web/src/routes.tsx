import React from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { LocalizedText } from './components/i18n/LocalizedText';
import { ProductLayout } from './layouts/ProductLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { LandingPage } from './pages/public/LandingPage';
import { StudentWorkspace } from './pages/product/StudentWorkspace';
import type { ProductRole } from './components/navigation/navigation-config';

interface ShellPageProps {
  readonly eyebrow: string;
  readonly title: React.ReactNode;
}

function ShellPage({ eyebrow, title }: ShellPageProps) {
  return (
    <section className="shell-page" aria-labelledby="shell-page-title">
      <header className="shell-page__header">
        <p className="shell-page__eyebrow" dir="auto">{eyebrow}</p>
        <h1 dir="auto" id="shell-page-title">{title}</h1>
        <p className="shell-page__lead" dir="auto">Shell structure reserved for a later product checkpoint.</p>
      </header>
      <div className="shell-page__card">
        <span className="shell-page__signal" aria-hidden="true" />
        <p dir="auto">This workspace is a structural placeholder. Its surface will be built in a later product checkpoint.</p>
      </div>
    </section>
  );
}

const roleRoutes: ReadonlyArray<{ path: string; role: ProductRole; title: string }> = [
  { path: 'student', role: 'student', title: 'Student workspace' },
  { path: 'teacher', role: 'teacher', title: 'Teacher workspace' },
  { path: 'institution', role: 'institution-admin', title: 'Institution administration' },
  { path: 'platform', role: 'super-admin', title: 'Platform operations' },
];

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route index element={<LandingPage />} />
        <Route path="about" element={<ShellPage eyebrow="Public" title={<LocalizedText ar="عن منارة" en="About Manara" />} />} />
      </Route>
      {roleRoutes.map(({ path, role, title }) => (
        <Route key={role} path={path} element={<ProductLayout role={role} />}>
          <Route index element={role === 'student' ? <StudentWorkspace /> : <ShellPage eyebrow="Workspace" title={title} />} />
          <Route path=":section" element={<ShellPage eyebrow="Workspace" title={title} />} />
        </Route>
      ))}
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
