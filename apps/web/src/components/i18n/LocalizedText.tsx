import React from 'react';

export interface LocalizedTextProps {
  readonly ar: string;
  readonly en: string;
}

export function LocalizedText({ ar, en }: LocalizedTextProps) {
  return (
    <>
      <span className="locale-copy" data-locale="ar" lang="ar">{ar}</span>
      <span className="locale-copy" data-locale="en" lang="en">{en}</span>
    </>
  );
}
