/** Typy dokumentow w Living Knowledge Base (sekcja 5 briefu). */
export const SOURCE_TYPES = [
  'COURSE', 'PRICE', 'FAQ', 'CONTACT', 'REGULATION', 'TEAM',
  'METHOD', 'NEWS', 'BLOG', 'EVENT', 'EXAM', 'LANDING_PAGE', 'GENERAL',
];

/** Intencje rozpoznawane wewnetrznie przez agenta (sekcja 12 briefu). */
export const INTENTS = [
  'COURSE_SEARCH', 'PRICE', 'SCHEDULE', 'CONTACT', 'TRIAL_LESSON', 'LEVEL_TEST',
  'CHILD', 'ADULT', 'COMPANY', 'EXAM', 'LANGUAGE_QUESTION', 'BLOG', 'NEWS',
  'LOCATION', 'REGULATION', 'GENERAL',
];

/**
 * Preferencje retrievalu: intencja -> uporzadkowana lista typow dokumentow.
 * Pierwszy typ ma najwyzszy bonus rankingowy (sekcja 5 briefu).
 */
export const INTENT_TYPE_PREFERENCE = {
  PRICE: ['PRICE', 'COURSE', 'FAQ'],
  COURSE_SEARCH: ['COURSE', 'LANDING_PAGE', 'METHOD', 'FAQ'],
  SCHEDULE: ['COURSE', 'NEWS', 'EVENT', 'FAQ'],
  NEWS: ['NEWS', 'COURSE', 'EVENT'],
  EVENT: ['EVENT', 'NEWS'],
  BLOG: ['BLOG', 'METHOD', 'FAQ'],
  LANGUAGE_QUESTION: ['BLOG', 'METHOD'],
  EXAM: ['EXAM', 'COURSE', 'BLOG'],
  CHILD: ['COURSE', 'LANDING_PAGE', 'METHOD', 'PRICE'],
  ADULT: ['COURSE', 'LANDING_PAGE', 'PRICE'],
  COMPANY: ['COURSE', 'LANDING_PAGE', 'PRICE', 'FAQ'],
  CONTACT: ['CONTACT', 'FAQ'],
  LOCATION: ['CONTACT', 'GENERAL'],
  TRIAL_LESSON: ['CONTACT', 'COURSE', 'FAQ'],
  LEVEL_TEST: ['COURSE', 'FAQ', 'METHOD'],
  REGULATION: ['REGULATION', 'FAQ'],
  GENERAL: ['LANDING_PAGE', 'COURSE', 'FAQ', 'GENERAL'],
};

/**
 * Hierarchia zrodel przy konflikcie (sekcja 9 briefu).
 * Nizsza liczba = wyzszy priorytet.
 */
export const SOURCE_AUTHORITY = {
  COURSE: 1,
  LANDING_PAGE: 1,
  PRICE: 2,
  NEWS: 3,
  EVENT: 3,
  FAQ: 4,
  CONTACT: 4,
  REGULATION: 4,
  METHOD: 5,
  TEAM: 5,
  EXAM: 5,
  BLOG: 6,
  GENERAL: 7,
};

/** Typy tresci, ktore szybko traca aktualnosc (sekcja 7 briefu). */
export const TIME_SENSITIVE_TYPES = new Set(['PRICE', 'NEWS', 'EVENT']);

export const isSourceType = (value) => SOURCE_TYPES.includes(value);
export const isIntent = (value) => INTENTS.includes(value);
export const authorityOf = (type) => SOURCE_AUTHORITY[type] ?? 8;
