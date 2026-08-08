export const SUPPORTED_LOCALES = ['ar', 'en'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type DocumentDirection = 'rtl' | 'ltr';

export const DEFAULT_LOCALE: SupportedLocale = 'ar';

interface DocumentRoot {
  dir: string;
  lang: string;
}

interface LocaleDocument {
  readonly documentElement: DocumentRoot;
  title: string;
}

export const DOCUMENT_TITLES: Readonly<Record<SupportedLocale, string>> = {
  ar: 'منارة',
  en: 'Manara',
};

export function normalizeLocale(value: string | null | undefined): SupportedLocale {
  const language = value?.trim().toLowerCase().split(/[-_]/, 1)[0];
  return language === 'en' ? 'en' : DEFAULT_LOCALE;
}

export function directionForLocale(locale: SupportedLocale): DocumentDirection {
  return locale === 'ar' ? 'rtl' : 'ltr';
}

export function applyDocumentLocale(document: LocaleDocument, locale: SupportedLocale): void {
  document.documentElement.lang = locale;
  document.documentElement.dir = directionForLocale(locale);
  document.title = DOCUMENT_TITLES[locale];
}
