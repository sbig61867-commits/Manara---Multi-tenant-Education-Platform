import React from 'react';
import { EntryHeader } from '../../components/entry/EntryHeader';
import { EntryHero } from '../../components/entry/EntryHero';

export function EntryPage() {
  return (
    <div className="entry-page">
      <EntryHeader />
      <main className="entry-main" id="main-content" tabIndex={-1}>
        <EntryHero />
      </main>
      <footer className="entry-footer">
        <p className="entry-footer__note" dir="auto">
          <span className="locale-copy" data-locale="ar" lang="ar">
            منارة — بنية موحدة لإدارة التعلم والتدريب.
          </span>
          <span className="locale-copy" data-locale="en" lang="en">
            Manara — a unified foundation for learning and training.
          </span>
        </p>
      </footer>
    </div>
  );
}
