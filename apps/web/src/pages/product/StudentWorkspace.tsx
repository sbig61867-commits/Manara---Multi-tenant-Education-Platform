import React from 'react';
import { LocalizedText } from '../../components/i18n/LocalizedText';

interface Course {
  readonly title: { ar: string; en: string };
  readonly progress: number;
  readonly next: { ar: string; en: string };
}

const courses: readonly Course[] = [
  { title: { ar: 'أسس إدارة المشاريع', en: 'Project Management Foundations' }, progress: 68, next: { ar: 'إدارة المخاطر', en: 'Risk Management' } },
  { title: { ar: 'تحليل البيانات', en: 'Data Analysis' }, progress: 42, next: { ar: 'التنظيف والتحويل', en: 'Cleaning & Transforming' } },
  { title: { ar: 'القيادة التربوية', en: 'Educational Leadership' }, progress: 15, next: { ar: 'بناء الرؤية', en: 'Building a Vision' } },
];

export function StudentWorkspace() {
  return (
    <div className="ws ws--student">
      <header className="ws__head">
        <p className="ws__eyebrow"><LocalizedText ar="مساحة الطالب" en="Student workspace" /></p>
        <h2><LocalizedText ar="أهلاً، رحلة التعلّم هذه" en="Your learning journey" /></h2>
        <p className="ws__lead">
          <LocalizedText ar="أمامك 3 مقررات نشطة و4 مهام مستحقة هذا الأسبوع. بيانات تجريبية لغرض العرض." en="3 active courses and 4 assignments due this week. Sample data for display." />
        </p>
      </header>

      <div className="ws__grid">
        <section className="ws-card iso lift3d" aria-labelledby="ws-courses">
          <h3 id="ws-courses"><LocalizedText ar="مقرراتي" en="My courses" /></h3>
          <ul className="ws-course-list">
            {courses.map((course) => (
              <li key={course.title.en} className="ws-course">
                <div className="ws-course__meta">
                  <span className="ws-course__title"><span lang="ar">{course.title.ar}</span><span lang="en">{course.title.en}</span></span>
                  <span className="ws-course__pct">{course.progress}%</span>
                </div>
                <div className="ws-course__track" aria-hidden="true">
                  <span className="ws-course__fill" style={{ width: `${course.progress}%` }} />
                </div>
                <p className="ws-course__next">
                  <LocalizedText ar="التالي:" en="Next:" /> <span lang="ar">{course.next.ar}</span> <span lang="en">{course.next.en}</span>
                </p>
              </li>
            ))}
          </ul>
        </section>

        <section className="ws-card iso lift3d" aria-labelledby="ws-progress">
          <h3 id="ws-progress"><LocalizedText ar="تقدّمك" en="Your progress" /></h3>
          <div className="ws-stat-row">
            <div className="ws-stat">
              <span className="ws-stat__value">4</span>
              <span className="ws-stat__label"><LocalizedText ar="مهام مستحقة" en="Assignments due" /></span>
            </div>
            <div className="ws-stat">
              <span className="ws-stat__value">86%</span>
              <span className="ws-stat__label"><LocalizedText ar="حضور" en="Attendance" /></span>
            </div>
            <div className="ws-stat">
              <span className="ws-stat__value">2</span>
              <span className="ws-stat__label"><LocalizedText ar="شهادات" en="Certificates" /></span>
            </div>
          </div>
          <span className="shape3d" aria-hidden="true">
            <span className="shape3d__face shape3d__face--front" />
            <span className="shape3d__face shape3d__face--top" />
            <span className="shape3d__face shape3d__face--right" />
          </span>
        </section>
      </div>
    </div>
  );
}
