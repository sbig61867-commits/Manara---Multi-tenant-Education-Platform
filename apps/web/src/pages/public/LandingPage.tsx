import React from 'react';
import { LocalizedText } from '../../components/i18n/LocalizedText';
import { InstitutionalRegister } from '../../components/public/InstitutionalRegister';
import { HeroMetrics } from '../../components/public/HeroMetrics';
import { PlatformWorkflowPreview } from '../../components/public/PlatformWorkflowPreview';
import { publicCopy, type LandingItem, type LocalizedCopy } from '../../content/public-content';
import { useSectionReveal } from '../../hooks/use-section-reveal';

function Copy({ value }: { readonly value: LocalizedCopy }) {
  return <LocalizedText {...value} />;
}

const audienceIcons: Record<string, React.ReactNode> = {
  'Universities and colleges': (
    <svg className="landing-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  'Academies and training centers': (
    <svg className="landing-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  ),
  'Institutional learning teams': (
    <svg className="landing-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  ),
};

function ItemList({ items, variant }: { readonly items: readonly LandingItem[]; readonly variant: string }) {
  return (
    <ul className={`landing-item-list landing-item-list--${variant}`}>
      {items.map((item, index) => (
        <li
          className={variant === 'principles' ? undefined : 'landing-card iso iso--dark lift3d'}
          data-reveal
          key={item.title.en}
          style={{ '--reveal-order': index, '--depth': `${8 + (index % 3) * 10}px` } as React.CSSProperties}
        >
          {variant === 'audiences' ? (
            <div className="landing-card__icon">{audienceIcons[item.title.en]}</div>
          ) : (
            <span className="landing-item-list__index" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
          )}
          {item.tag ? (
            <span className="landing-item-list__tag"><Copy value={item.tag} /></span>
          ) : null}
          {variant === 'principles' ? (
            <span className="shape3d" aria-hidden="true">
              <span className="shape3d__face shape3d__face--front" />
              <span className="shape3d__face shape3d__face--top" />
              <span className="shape3d__face shape3d__face--right" />
            </span>
          ) : null}
          <h3><Copy value={item.title} /></h3>
          <p><Copy value={item.description} /></p>
        </li>
      ))}
    </ul>
  );
}

export function LandingPage() {
  useSectionReveal();

  return (
    <article className="landing-page">
      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="hero-glow" aria-hidden="true" />
        <div className="hero-beam hero-beam--sweep" aria-hidden="true" />
        <div className="landing-hero__copy" data-reveal data-revealed="true">
          <p className="landing-eyebrow"><Copy value={publicCopy.hero.eyebrow} /></p>
          <h1 id="landing-title">
            <span className="locale-copy" data-locale="ar" lang="ar">حين تتوزع أدوات التعليم، <span className="hero-accent">تضيع الصورة الكاملة</span></span>
            <span className="locale-copy" data-locale="en" lang="en">When learning tools fragment, <span className="hero-accent">the full picture disappears</span></span>
          </h1>
          <p className="landing-hero__summary"><Copy value={publicCopy.hero.problem} /></p>
          <p className="landing-hero__solution"><Copy value={publicCopy.hero.solution} /></p>
          <div className="landing-actions">
            <a className="landing-action landing-action--primary" href="#capabilities">
              <LocalizedText ar="اكتشف ما تجمعه المنصة" en="Explore what the platform brings together" />
            </a>
            <a className="landing-action landing-action--secondary" href="#workflow">
              <LocalizedText ar="شاهد كيف تعمل" en="See how it works" />
            </a>
          </div>
          <HeroMetrics metrics={publicCopy.hero.metrics} />
        </div>
        <InstitutionalRegister />
      </section>

      <section className="principles-band" aria-labelledby="principles-title">
        <h2 className="visually-hidden" id="principles-title"><LocalizedText ar="ما تقدمه المنصة" en="What the platform provides" /></h2>
        <ItemList items={publicCopy.principles} variant="principles" />
      </section>

      <section className="landing-section landing-section--audiences" id="capabilities" aria-labelledby="capabilities-title">
        <div className="landing-section__intro" data-reveal>
          <p className="landing-eyebrow"><LocalizedText ar="من المشكلة إلى العمل الواضح" en="From fragmentation to clear work" /></p>
          <h2 id="capabilities-title"><LocalizedText ar="كل ما تحتاجه المؤسسة لرؤية رحلة التعلّم كاملة" en="What institutions need to see the full learning journey" /></h2>
          <p><LocalizedText ar="تخدم منارة الجامعة والأكاديمية ومركز التدريب من دون أن تفرض نموذجاً واحداً. تبقى الأدوار والمسؤوليات واضحة مهما اختلفت بنية المؤسسة." en="Manara supports universities, academies, and training centers without forcing one model. Roles and responsibilities stay clear as each institution grows." /></p>
        </div>
        <ItemList items={publicCopy.audiences} variant="audiences" />
        <div className="capability-ledger">
          <div className="capability-ledger__heading" data-reveal>
            <span aria-hidden="true" className="capability-ledger__signal" />
            <h2><LocalizedText ar="قدرات مترابطة حول رحلة التعلّم" en="Connected capabilities for the learning journey" /></h2>
          </div>
          <ItemList items={publicCopy.capabilities} variant="capabilities" />
        </div>
      </section>

      <section className="landing-section landing-section--workflow" id="workflow" aria-labelledby="workflow-title">
        <div className="landing-section__intro" data-reveal>
          <p className="landing-eyebrow"><LocalizedText ar="من التنظيم إلى الأثر" en="From organization to impact" /></p>
          <h2 id="workflow-title"><LocalizedText ar="مسار واحد يربط ما تخطط له المؤسسة بما يعيشه المتعلّم" en="One flow connecting institutional plans with the learner experience" /></h2>
          <p><LocalizedText ar="ينتقل العمل من تنظيم المؤسسة إلى تقديم التعلّم والتقييم ومراجعة النتائج، من دون نقل الفريق بين أدوات متباعدة." en="Work moves from organization to learning delivery, assessment, and review without moving teams between disconnected tools." /></p>
        </div>
        <ItemList items={publicCopy.roles} variant="roles" />
        <div data-reveal><PlatformWorkflowPreview /></div>
      </section>

      <section className="landing-section landing-section--governance" id="governance" aria-labelledby="governance-title">
        <div className="governance-register" data-reveal>
          <p className="landing-eyebrow"><LocalizedText ar="ثقة لا تعقيد" en="Trust without complexity" /></p>
          <h2 id="governance-title"><LocalizedText ar="حدود واضحة تحمي عمل كل مؤسسة" en="Clear boundaries that protect each institution's work" /></h2>
          <p><LocalizedText ar="تحافظ منارة على فصل المؤسسات، وتمنح الوصول بحسب الدور، وتسجل العمليات المهمة حتى تبقى المتابعة ممكنة وواضحة." en="Manara separates institutions, grants access by role, and records important operations so follow-up stays possible and clear." /></p>
          <ul className="governance-register__list">
            <li><LocalizedText ar="فصل واضح بين المؤسسات" en="Clear separation between institutions" /></li>
            <li><LocalizedText ar="وصول مناسب لكل دور" en="Appropriate access for every role" /></li>
            <li><LocalizedText ar="حدود استخدام قابلة للمتابعة" en="Usage limits that can be monitored" /></li>
            <li><LocalizedText ar="سجل للعمليات المهمة" en="A record of important operations" /></li>
          </ul>
        </div>
        <div className="stack3d" data-reveal>
          <span className="stack3d__layer stack3d__layer--1" aria-hidden="true" />
          <span className="stack3d__layer stack3d__layer--2" aria-hidden="true" />
          <aside className="future-note stack3d__layer--3" aria-labelledby="future-title">
            <span className="future-note__status"><LocalizedText ar="اتجاه مستقبلي" en="Future direction" /></span>
            <h2 id="future-title"><LocalizedText ar="مساعدة ذكية تحت إشراف المؤسسة" en="Assisted work under institutional oversight" /></h2>
            <p><LocalizedText ar="تتجه منارة مستقبلاً إلى مساعدة الفرق في بناء المحتوى والأسئلة والتلخيص. هذه القدرات ليست متاحة في المنصة اليوم، وستبقى تحت صلاحيات واضحة ومراجعة بشرية." en="Manara may later help teams create content, questions, and summaries. These capabilities are not available in the platform today and will remain subject to clear permissions and human review." /></p>
          </aside>
        </div>
      </section>

      <section className="landing-final" aria-labelledby="final-title" data-reveal>
        <span className="landing-final__coordinate" aria-hidden="true" />
        <h2 id="final-title"><LocalizedText ar="التعليم المؤسسي أوضح حين تعمل أجزاؤه معاً" en="Institutional learning becomes clearer when its parts work together" /></h2>
        <p><LocalizedText ar="منارة تساعد المؤسسة على تنظيم التعلم ومتابعته وفهمه في مكان واحد." en="Manara helps institutions organize, follow, and understand learning in one place." /></p>
        <a className="landing-action landing-action--primary" href="#capabilities"><LocalizedText ar="استكشف المنصة" en="Explore the platform" /></a>
      </section>
    </article>
  );
}
