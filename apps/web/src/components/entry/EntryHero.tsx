import React from 'react';
import { BeaconNode } from '../beacon/BeaconNode';
import { BeaconRail } from '../beacon/BeaconRail';
import { RegistrationMark } from '../beacon/RegistrationMark';
import { Button } from '../ui/Button';

interface EntryHeroProps {
  readonly onPrimaryAction?: () => void;
}

export function EntryHero({ onPrimaryAction }: EntryHeroProps) {
  return (
    <section className="entry-hero" aria-labelledby="entry-hero-title">
      <h1 className="entry-hero__title" id="entry-hero-title" dir="auto">
        <span className="locale-copy" data-locale="ar" lang="ar">
          منصة سحابية متعددة المؤسسات لإدارة التعليم والتدريب
        </span>
        <span className="locale-copy" data-locale="en" lang="en">
          A multi-tenant cloud platform for learning and training management
        </span>
      </h1>
      <p className="entry-hero__lead" dir="auto">
        <span className="locale-copy" data-locale="ar" lang="ar">
          نواة واحدة مرنة، قابلة للتخصيص لكل مؤسسة، بأمان وعزل كاملين.
        </span>
        <span className="locale-copy" data-locale="en" lang="en">
          One flexible core, configurable for every institution, with full security and isolation.
        </span>
      </p>
      <div className="entry-hero__actions">
        <Button variant="primary" onClick={onPrimaryAction}>
          <span className="locale-copy" data-locale="ar" lang="ar">اطلب الانضمام</span>
          <span className="locale-copy" data-locale="en" lang="en">Request access</span>
        </Button>
      </div>
      <div className="entry-hero__beacon" aria-hidden="true">
        <BeaconRail orientation="horizontal" purpose="progress">
          <BeaconNode meaning="checkpoint" state="complete" />
          <BeaconNode meaning="memory" state="current" />
          <BeaconNode meaning="consequence" state="pending" />
        </BeaconRail>
        <RegistrationMark context="coordinate" />
      </div>
    </section>
  );
}
