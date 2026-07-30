export const PUBLIC_THEME_IDS = [
  'gold-night',
  'royal-night',
  'crimson-sun',
  'violet-blush',
  'teal-night',
  'sunset-cream',
  'orchid-rose',
] as const;

export type PublicThemeId = typeof PUBLIC_THEME_IDS[number];

export type PublicTheme = {
  id: PublicThemeId;
  name: string;
  mode: 'dark' | 'light';
  swatches: [string, string, string];
};

export const PUBLIC_THEMES: PublicTheme[] = [
  { id: 'gold-night', name: 'Noche dorada', mode: 'dark', swatches: ['#0a0d17', '#d6ad59', '#f0c676'] },
  { id: 'royal-night', name: 'Noche real', mode: 'dark', swatches: ['#0a1124', '#9bb7ff', '#f7b267'] },
  { id: 'crimson-sun', name: 'Sol carmesí', mode: 'dark', swatches: ['#1a0d10', '#f4c542', '#ff7b3d'] },
  { id: 'violet-blush', name: 'Violeta suave', mode: 'dark', swatches: ['#140f1f', '#f06bb4', '#b584ff'] },
  { id: 'teal-night', name: 'Verde azulado', mode: 'light', swatches: ['#f5fbfb', '#0e7c7b', '#d15b29'] },
  { id: 'sunset-cream', name: 'Crema al atardecer', mode: 'light', swatches: ['#fff8f3', '#c9472a', '#d9941a'] },
  { id: 'orchid-rose', name: 'Orquídea rosa', mode: 'light', swatches: ['#fdf8ff', '#8d48c5', '#d74b91'] },
];

export const DEFAULT_PUBLIC_THEME_ID: PublicThemeId = 'gold-night';

export function resolvePublicThemeId(value: unknown): PublicThemeId {
  return typeof value === 'string' && (PUBLIC_THEME_IDS as readonly string[]).includes(value)
    ? value as PublicThemeId
    : DEFAULT_PUBLIC_THEME_ID;
}
