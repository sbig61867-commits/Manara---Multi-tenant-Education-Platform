import React, { useState } from 'react';
import { LocalizedText } from '../i18n/LocalizedText';
import { ManaraLogo3D } from '../navigation/ManaraLogo3D';

export function InstitutionalRegister() {
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [hoveredStep, setHoveredStep] = useState<number | null>(null);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTilt({ x: x * 12, y: -y * 12 });
  };

  const handleMouseLeave = () => {
    setTilt({ x: 0, y: 0 });
    setHoveredStep(null);
  };

  const steps = [
    { num: '01', title: { ar: 'المؤسسة', en: 'Institution' }, desc: { ar: 'السياق الهيكلي', en: 'Structure & Context' } },
    { num: '02', title: { ar: 'البرنامج', en: 'Program' }, desc: { ar: 'المسار والتصاميم', en: 'Curriculum & Path' } },
    { num: '03', title: { ar: 'المتعلّم', en: 'Learner' }, desc: { ar: 'التفاعل والنشاط', en: 'Activity & Progress' } },
    { num: '04', title: { ar: 'الأثر', en: 'Impact' }, desc: { ar: 'الإنجاز والاعتماد', en: 'Evidence & Outcome' } },
  ] as const;

  return (
    <figure
      className="institutional-register hero-3d-stage"
      aria-labelledby="register-caption"
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={{
        transform: `perspective(1000px) rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)`,
        transition: tilt.x === 0 ? 'transform 0.6s ease-out' : 'none',
      }}
    >
      <figcaption className="visually-hidden" id="register-caption">
        <LocalizedText
          ar="مجسم منارة ثلاثي الأبعاد يعرض المسار المؤسسي للتعليم."
          en="3D Manara Beacon visual displaying institutional learning journey."
        />
      </figcaption>

      {/* Luxury Centerpiece 3D Beacon Logo */}
      <div className="hero-3d-logo-wrapper">
        <ManaraLogo3D size="hero" animated={false} />
        <div className="beacon-radial-halo" />
      </div>

      {/* Live telemetry strip (realistic product signal) */}
      <div className="hero-telemetry" aria-label="Live institutional telemetry">
        <div className="hero-telemetry__bar">
          <span className="hero-telemetry__dot" aria-hidden="true" />
          <span className="hero-telemetry__status">
            <LocalizedText ar="القياسات المؤسسية الحية" en="Live Institutional Telemetry" />
          </span>
        </div>
        <div className="hero-telemetry__grid">
          <div className="hero-telemetry__cell">
            <strong>42</strong>
            <span><LocalizedText ar="مناهج نشطة" en="Active programs" /></span>
          </div>
          <div className="hero-telemetry__cell">
            <strong>96.4%</strong>
            <span><LocalizedText ar="إكمال الدفعات" en="Cohort completion" /></span>
          </div>
          <div className="hero-telemetry__cell">
            <strong>12,450</strong>
            <span><LocalizedText ar="متعلم نشط" en="Active learners" /></span>
          </div>
        </div>
        <div className="hero-telemetry__progress">
          <span className="hero-telemetry__progress-label">
            <LocalizedText ar="استخدام السعة" en="Capacity utilization" />
          </span>
          <span className="hero-telemetry__progress-track" aria-hidden="true">
            <span className="hero-telemetry__progress-fill" style={{ width: '86%' }} />
          </span>
        </div>
      </div>

      {/* Clean Orbiting Interactive Step Nodes (Non-overlapping) */}
      <div className="hero-3d-nodes-grid">
        {steps.map((step, idx) => (
          <div
            key={step.num}
            className={`hero-3d-node-card step-${step.num} ${hoveredStep === idx ? 'is-hovered' : ''}`}
            onMouseEnter={() => setHoveredStep(idx)}
          >
            <span className="node-num">{step.num}</span>
            <div className="node-info">
              <strong><LocalizedText {...step.title} /></strong>
              <small><LocalizedText {...step.desc} /></small>
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}
