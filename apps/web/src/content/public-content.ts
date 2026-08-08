export interface LocalizedCopy {
  readonly ar: string;
  readonly en: string;
}

export interface LandingItem {
  readonly description: LocalizedCopy;
  readonly title: LocalizedCopy;
  readonly tag?: LocalizedCopy;
}

export interface Metric {
  readonly value: number;
  readonly label: LocalizedCopy;
}

export const publicCopy = {
  hero: {
    eyebrow: { ar: 'منارة للتعليم المؤسسي', en: 'Manara for institutional learning' },
    title: {
      ar: 'حين تتوزع أدوات التعليم، تضيع الصورة الكاملة',
      en: 'When learning tools fragment, the full picture disappears',
    },
    problem: {
      ar: 'تتبعثر البرامج والمحتوى والتقييم والأعضاء بين أنظمة لا تتحدث معاً، فيبطؤ القرار وتضيع المسؤوليات.',
      en: 'Programs, content, assessment, and people become scattered across systems that do not work together. Decisions slow down and responsibility becomes unclear.',
    },
    solution: {
      ar: 'تجمع منارة العمل التعليمي في مساحة واحدة واضحة. ترى المؤسسة ما يحدث، ويعرف كل شخص ما عليه فعله بعد ذلك.',
      en: 'Manara brings learning work into one clear place. Institutions can see what is happening, and every person can see what to do next.',
    },
    metrics: [
      { value: 1, label: { ar: 'مساحة عمل واحدة', en: 'Single workspace' } },
      { value: 4, label: { ar: 'مراحل لرحلة التعلّم', en: 'Stages of the journey' } },
      { value: 3, label: { ar: 'أدوار واضحة', en: 'Clear roles' } },
      { value: 5, label: { ar: 'قدرات مترابطة', en: 'Connected capabilities' } },
    ] satisfies readonly Metric[],
  },
  principles: [
    { title: { ar: 'صورة مشتركة', en: 'One shared picture' }, description: { ar: 'تظهر البرامج والأعضاء والتقدم في سياق واحد يمكن الرجوع إليه.', en: 'Programs, people, and progress remain visible in one place that teams can return to.' } },
    { title: { ar: 'عمل واضح لكل دور', en: 'Clear work for every role' }, description: { ar: 'يعرف المتعلم والمعلم والإدارة ما يحتاجه كل منهم دون ازدحام أو غموض.', en: 'Learners, educators, and administrators can focus on what each role needs without clutter or ambiguity.' } },
    { title: { ar: 'قرارات يمكن مراجعتها', en: 'Decisions that can be reviewed' }, description: { ar: 'تحافظ المؤسسة على حدود الوصول وسجل العمل عند الحاجة إلى المتابعة.', en: 'Institutions retain clear access boundaries and a record of important work when follow-up is needed.' } },
  ] satisfies readonly LandingItem[],
  audiences: [
    { title: { ar: 'الجامعات والكليات', en: 'Universities and colleges' }, description: { ar: 'تنظيم البرامج والمجموعات والمحتوى والتقييم ضمن بنية واحدة.', en: 'Organize programs, cohorts, content, and assessment in one structure.' } },
    { title: { ar: 'الأكاديميات ومراكز التدريب', en: 'Academies and training centers' }, description: { ar: 'إدارة مسارات تعليمية مرنة مع الحفاظ على وضوح المسؤوليات.', en: 'Run flexible learning paths while keeping responsibilities clear.' } },
    { title: { ar: 'فرق التعلّم داخل المؤسسات', en: 'Institutional learning teams' }, description: { ar: 'توحيد العمل بين الإدارة والمعلمين والمتعلمين حول رحلة تعليمية مشتركة.', en: 'Bring administrators, educators, and learners around one shared learning journey.' } },
  ] satisfies readonly LandingItem[],
  capabilities: [
    { title: { ar: 'البرامج والمحتوى', en: 'Programs and content' }, description: { ar: 'برامج ومقررات ووحدات ومواد مترابطة.', en: 'Connected programs, courses, units, and learning materials.' }, tag: { ar: 'الوحدة 01', en: 'MODULE 01' } },
    { title: { ar: 'التقييم والتقدم', en: 'Assessment and progress' }, description: { ar: 'أسئلة ومحاولات وتصحيح ومتابعة للنتائج.', en: 'Questions, attempts, grading, and a view of outcomes.' }, tag: { ar: 'الوحدة 02', en: 'MODULE 02' } },
    { title: { ar: 'الحضور والشهادات', en: 'Attendance and certificates' }, description: { ar: 'متابعة المشاركة وربط الإنجاز بما يثبتها.', en: 'Track participation and connect achievement with evidence.' }, tag: { ar: 'الوحدة 03', en: 'MODULE 03' } },
    { title: { ar: 'الإدارة والمتابعة', en: 'Administration and oversight' }, description: { ar: 'الأعضاء والصلاحيات والبرامج ضمن رؤية تشغيلية منظمة.', en: 'People, access, and programs in an organized operational view.' }, tag: { ar: 'الوحدة 04', en: 'MODULE 04' } },
  ] satisfies readonly LandingItem[],
  roles: [
    { title: { ar: 'للمتعلم', en: 'For learners' }, description: { ar: 'رحلة مركزة توضح المطلوب والتقدم خطوة بخطوة.', en: 'A focused journey that makes the next step and progress clear.' }, tag: { ar: 'مسار المتعلم', en: 'LEARNER PATHWAY' } },
    { title: { ar: 'للمعلم', en: 'For educators' }, description: { ar: 'أدوات منظمة للتدريس والمتابعة والتقييم.', en: 'Structured tools for teaching, follow-up, and assessment.' }, tag: { ar: 'مسار المعلم', en: 'EDUCATOR PATHWAY' } },
    { title: { ar: 'لإدارة المؤسسة', en: 'For institution teams' }, description: { ar: 'رؤية عملية للأعضاء والصلاحيات والبرامج.', en: 'A practical view of people, access, and programs.' }, tag: { ar: 'مسار الإدارة', en: 'ADMINISTRATION PATHWAY' } },
  ] satisfies readonly LandingItem[],
} as const;
