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
          نواة واحدة مرنة تتكيف مع نماذج كل مؤسسة ومصطلحاتها وطريقة عملها.
        </span>
        <span className="locale-copy" data-locale="en" lang="en">
          A single flexible core that adapts to each institution's models, terminology, and way of working.
        </span>
      </p>
      <div className="entry-hero__actions">
        <Button variant="primary" onClick={onPrimaryAction}>
          <span className="locale-copy" data-locale="ar" lang="ar">اطلب الانضمام</span>
          <span className="locale-copy" data-locale="en" lang="en">Request access</span>
        </Button>
      </div>
      <p className="entry-hero__trust" dir="auto">
        <span className="locale-copy" data-locale="ar" lang="ar">
          عزل كامل للبيانات بين المؤسسات، وصلاحيات دقيقة، وسجلات تدقيق.
        </span>
        <span className="locale-copy" data-locale="en" lang="en">
          Full data isolation between institutions, granular permissions, and audit records.
        </span>
      </p>
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
