export type ProductRole = 'student' | 'teacher' | 'institution-admin' | 'super-admin';

export interface NavigationItem {
  readonly label: string;
  readonly shortLabel: string;
  readonly to: string;
}

export interface ProductNavigation {
  readonly label: string;
  readonly items: readonly NavigationItem[];
}

export const productNavigation: Readonly<Record<ProductRole, ProductNavigation>> = {
  student: {
    label: 'Student / الطالب',
    items: [
      { label: 'Overview / النظرة العامة', shortLabel: 'Overview', to: '/student' },
      { label: 'Learning / التعلّم', shortLabel: 'Learning', to: '/student/learning' },
      { label: 'Progress / التقدّم', shortLabel: 'Progress', to: '/student/progress' },
    ],
  },
  teacher: {
    label: 'Teacher / المعلّم',
    items: [
      { label: 'Overview / النظرة العامة', shortLabel: 'Overview', to: '/teacher' },
      { label: 'Classes / الصفوف', shortLabel: 'Classes', to: '/teacher/classes' },
      { label: 'Assessment / التقييم', shortLabel: 'Assessment', to: '/teacher/assessment' },
    ],
  },
  'institution-admin': {
    label: 'Institution admin / إدارة المؤسسة',
    items: [
      { label: 'Overview / النظرة العامة', shortLabel: 'Overview', to: '/institution' },
      { label: 'Members / الأعضاء', shortLabel: 'Members', to: '/institution/members' },
      { label: 'Settings / الإعدادات', shortLabel: 'Settings', to: '/institution/settings' },
    ],
  },
  'super-admin': {
    label: 'Super Admin / الإدارة العليا',
    items: [
      { label: 'Operations / العمليات', shortLabel: 'Operations', to: '/platform' },
      { label: 'Institutions / المؤسسات', shortLabel: 'Institutions', to: '/platform/institutions' },
      { label: 'Audit / التدقيق', shortLabel: 'Audit', to: '/platform/audit' },
    ],
  },
};
