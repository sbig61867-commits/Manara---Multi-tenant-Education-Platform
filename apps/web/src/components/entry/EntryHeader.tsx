import React from 'react';

export function EntryHeader() {
  return (
    <header className="entry-header">
      <a className="shell-identity" href="/">
        <span className="shell-identity__wordmark" data-locale="ar" lang="ar">منارة</span>
        <span className="shell-identity__wordmark" data-locale="en" lang="en">Manara</span>
      </a>
    </header>
  );
}
