import React, { useState } from 'react';
import { LocalizedText } from '../i18n/LocalizedText';

const workflowSteps = [
  {
    step: '01',
    stage: { ar: 'مؤسسة', en: 'Institution' },
    title: { ar: 'تحديد الهيكلية والمجالات', en: 'Define Structure & Domains' },
    desc: { ar: 'إعداد سياقات التعلّم والأدوار ونطاقات الصلاحيات المؤسسية.', en: 'Setup learning contexts, roles, and institutional permissions.' },
    icon: '🏛️',
  },
  {
    step: '02',
    stage: { ar: 'برنامج', en: 'Program' },
    title: { ar: 'تصميم المسارات التعليمية', en: 'Design Learning Pathways' },
    desc: { ar: 'بناء البرامج والمناهج والأهداف التعلّمية القابلة للقياس.', en: 'Build programs, curricula, and measurable learning objectives.' },
    icon: '📘',
  },
  {
    step: '03',
    stage: { ar: 'متعلّم', en: 'Learner' },
    title: { ar: 'التفاعل والتقييم المستمر', en: 'Engagement & Assessment' },
    desc: { ar: 'تقديم المحتوى التفاعلي والاختبارات ومتابعة التقدّم الفردي.', en: 'Deliver interactive content, quizzes, and track individual progress.' },
    icon: '🎓',
  },
  {
    step: '04',
    stage: { ar: 'أثر / إنجاز', en: 'Impact / Achievement' },
    title: { ar: 'قياس الأثر والتوثيق', en: 'Measure Impact & Record' },
    desc: { ar: 'توليد التقارير القيادية، التوثيق الرسمي، وسجل الإنجاز.', en: 'Generate executive reports, official documentation, and records.' },
    icon: '✨',
  },
] as const;

export function PlatformWorkflowPreview() {
  const [activeStep, setActiveStep] = useState<number>(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 8, y: -y * 8 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
  };

  return (
    <figure
      className="workflow-preview 3d-card-wrapper"
      aria-labelledby="workflow-preview-caption"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(1000px) rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
        transition: tilt.x === 0 ? 'transform 0.5s ease-out' : 'none',
      }}
    >
      <figcaption id="workflow-preview-caption">
        <span className="workflow-preview__label">
          <LocalizedText ar="تصوّر هيكلي" en="Structural preview" />
        </span>
        <LocalizedText
          ar="يعرض هذا التصوّر تنظيم الواجهة والعلاقات، ولا يمثّل لوحة بيانات مكتملة."
          en="This preview demonstrates interface organization and relationships, not a completed dashboard."
        />
      </figcaption>

      <div className="workflow-preview__shell dark-3d-model">
        {/* Step Selector Header */}
        <div className="workflow-preview__step-bar">
          {workflowSteps.map((s, index) => (
            <button
              key={s.step}
              type="button"
              className={`workflow-step-tab ${index === activeStep ? 'is-active' : ''}`}
              onClick={() => setActiveStep(index)}
              aria-selected={index === activeStep}
            >
              <span className="step-num">{s.step}</span>
              <span className="step-label"><LocalizedText {...s.stage} /></span>
              {index === activeStep && <span className="active-beam-glow" />}
            </button>
          ))}
        </div>

        {/* Step Content Preview Panel */}
        {(() => {
          const current = workflowSteps[activeStep] ?? workflowSteps[0];
          return (
            <div className="workflow-preview__main-display">
              <div className="workflow-stage-card">
                <div className="workflow-stage-card__header">
                  <span className="stage-icon">{current.icon}</span>
                  <div>
                    <p className="stage-tag"><LocalizedText ar={`الخطوة ${current.step}`} en={`Step ${current.step}`} /></p>
                    <h3><LocalizedText {...current.title} /></h3>
                  </div>
                </div>
                <p className="stage-desc">
                  <LocalizedText {...current.desc} />
                </p>

                {/* Interactive Beam Connector Visual */}
                <div className="workflow-beam-indicator">
                  <div className="beam-track">
                    <div
                      className="beam-progress"
                      style={{ transform: `scaleX(${(activeStep + 1) / workflowSteps.length})`, transformOrigin: 'left' }}
                    />
                  </div>
                  <div className="beam-nodes">
                    {workflowSteps.map((_, i) => (
                      <span
                        key={i}
                        className={`beam-node ${i <= activeStep ? 'reached' : ''} ${i === activeStep ? 'current' : ''}`}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
    </figure>
  );
}
