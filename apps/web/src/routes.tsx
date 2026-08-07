import React from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { ProductLayout } from './layouts/ProductLayout';
import { PublicLayout } from './layouts/PublicLayout';
import type { ProductRole } from './components/navigation/navigation-config';

interface ShellPageProps {
  readonly eyebrow: string;
  readonly title: React.ReactNode;
}

function LocalizedText({ ar, en }: { readonly ar: string; readonly en: string }) {
  return (
    <>
      <span className="locale-copy" data-locale="ar" lang="ar">{ar}</span>
      <span className="locale-copy" data-locale="en" lang="en">{en}</span>
    </>
  );
}

function ShellPage({ eyebrow, title }: ShellPageProps) {
  return (
    <section className="shell-placeholder" aria-labelledby="shell-page-title">
      <p className="shell-placeholder__eyebrow" dir="auto">{eyebrow}</p>
      <h1 dir="auto" id="shell-page-title">{title}</h1>
      <p dir="auto">Shell structure reserved for a later product checkpoint.</p>
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
        <Route index element={<ShellPage eyebrow="Public" title={<LocalizedText ar="منارة" en="Manara" />} />} />
        <Route path="about" element={<ShellPage eyebrow="Public" title={<LocalizedText ar="عن منارة" en="About Manara" />} />} />
      </Route>
      {roleRoutes.map(({ path, role, title }) => (
        <Route key={role} path={path} element={<ProductLayout role={role} />}>
          <Route index element={<ShellPage eyebrow="Workspace" title={title} />} />
          <Route path=":section" element={<ShellPage eyebrow="Workspace" title={title} />} />
        </Route>
      ))}
      <Route path="*" element={<Navigate replace to="/" />} />
    </Routes>
  );
}
