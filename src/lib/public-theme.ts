export const PUBLIC_THEME_IDS = [
  'gold-night',
  'royal-night',
  'crimson-sun',
  'violet-blush',
  'teal-night',
  'sunset-cream',
  'orchid-rose',
  'custom',
] as const;

export type PublicThemeId = (typeof PUBLIC_THEME_IDS)[number];
export type PresetPublicThemeId = Exclude<PublicThemeId, 'custom'>;

export type CustomThemePalette = {
  background: string;
  surface: string;
  text: string;
  primary: string;
};

export type PublicTheme = {
  id: PublicThemeId;
  name: string;
  mode: 'dark' | 'light';
  swatches: [string, string, string];
};

export type ResolvedPublicTheme = {
  id: PublicThemeId;
  customPalette?: CustomThemePalette;
};

export const PUBLIC_THEMES: PublicTheme[] = [
  {
    id: 'gold-night',
    name: 'Noche dorada',
    mode: 'dark',
    swatches: ['#0a0d17', '#d6ad59', '#f0c676'],
  },
  {
    id: 'royal-night',
    name: 'Noche real',
    mode: 'dark',
    swatches: ['#0a1124', '#9bb7ff', '#f7b267'],
  },
  {
    id: 'crimson-sun',
    name: 'Sol carmesí',
    mode: 'dark',
    swatches: ['#1a0d10', '#f4c542', '#ff7b3d'],
  },
  {
    id: 'violet-blush',
    name: 'Violeta suave',
    mode: 'dark',
    swatches: ['#140f1f', '#f06bb4', '#b584ff'],
  },
  {
    id: 'teal-night',
    name: 'Verde azulado',
    mode: 'light',
    swatches: ['#f5fbfb', '#0e7c7b', '#d15b29'],
  },
  {
    id: 'sunset-cream',
    name: 'Crema al atardecer',
    mode: 'light',
    swatches: ['#fff8f3', '#c9472a', '#d9941a'],
  },
  {
    id: 'orchid-rose',
    name: 'Orquídea rosa',
    mode: 'light',
    swatches: ['#fdf8ff', '#8d48c5', '#d74b91'],
  },
  {
    id: 'custom',
    name: 'Tema personalizado',
    mode: 'light',
    swatches: ['#0a0d17', '#f2f2f1', '#d6ad59'],
  },
];

export const DEFAULT_PUBLIC_THEME_ID: PresetPublicThemeId = 'gold-night';
export const DEFAULT_CUSTOM_THEME_PALETTE: CustomThemePalette = {
  background: '#0a0d17',
  surface: '#151923',
  text: '#f2f2f1',
  primary: '#d6ad59',
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const AA_CONTRAST = 4.5;

function normalizeHexColor(value: unknown): string | null {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : null;
}

function relativeLuminance(color: string): number {
  const channels = [1, 3, 5].map(
    (index) => Number.parseInt(color.slice(index, index + 2), 16) / 255,
  );
  const [red, green, blue] = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

export function contrastRatio(first: string, second: string): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
  return (
    (Math.max(firstLuminance, secondLuminance) + 0.05) /
    (Math.min(firstLuminance, secondLuminance) + 0.05)
  );
}

export function primaryActionTextColor(primary: string): '#111111' | '#ffffff' {
  return contrastRatio(primary, '#111111') >= contrastRatio(primary, '#ffffff')
    ? '#111111'
    : '#ffffff';
}

export function validateCustomThemePalette(value: unknown): {
  palette?: CustomThemePalette;
  error?: string;
} {
  const source =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const paletteKeys = Object.keys(source);
  if (
    paletteKeys.length !== 4 ||
    !(['background', 'surface', 'text', 'primary'] as const).every((key) =>
      Object.hasOwn(source, key),
    )
  ) {
    return { error: 'Use exactamente los cuatro colores del tema personalizado.' };
  }
  const background = normalizeHexColor(source.background);
  const surface = normalizeHexColor(source.surface);
  const text = normalizeHexColor(source.text);
  const primary = normalizeHexColor(source.primary);

  if (!background || !surface || !text || !primary) {
    return { error: 'Use colores hexadecimales de seis dígitos.' };
  }
  if (contrastRatio(text, background) < AA_CONTRAST || contrastRatio(text, surface) < AA_CONTRAST) {
    return { error: 'El texto debe tener contraste AA con el fondo y la superficie.' };
  }
  if (contrastRatio(primary, primaryActionTextColor(primary)) < AA_CONTRAST) {
    return { error: 'La acción principal no tiene contraste AA suficiente.' };
  }
  if (
    contrastRatio(primary, background) < AA_CONTRAST ||
    contrastRatio(primary, surface) < AA_CONTRAST
  ) {
    return { error: 'La acción principal debe tener contraste AA con el fondo y la superficie.' };
  }
  return { palette: { background, surface, text, primary } };
}

export function themeForPersistence(
  id: PublicThemeId,
  palette: unknown,
): {
  theme?: { id: PresetPublicThemeId } | { id: 'custom'; palette: CustomThemePalette };
  error?: string;
} {
  if (id !== 'custom') return { theme: { id } };
  const result = validateCustomThemePalette(palette);
  return result.palette ? { theme: { id, palette: result.palette } } : { error: result.error };
}

export function resolvePublicThemeId(value: unknown): PublicThemeId {
  return typeof value === 'string' && (PUBLIC_THEME_IDS as readonly string[]).includes(value)
    ? (value as PublicThemeId)
    : DEFAULT_PUBLIC_THEME_ID;
}

export function resolvePublicTheme(value: unknown): ResolvedPublicTheme {
  const theme =
    value && typeof value === 'object' ? (value as { id?: unknown; palette?: unknown }) : {};
  const id = resolvePublicThemeId(theme.id);
  if (id !== 'custom') return { id };
  const { palette } = validateCustomThemePalette(theme.palette);
  return palette ? { id, customPalette: palette } : { id: DEFAULT_PUBLIC_THEME_ID };
}

/** Derives all shared UI tokens from the four administrator-selected semantic colors. */
export function customThemeCssVariables(palette: CustomThemePalette): Record<string, string> {
  const onPrimary = primaryActionTextColor(palette.primary);
  const hoverMix = onPrimary === '#111111' ? '#ffffff' : '#111111';
  return {
    '--bg': palette.background,
    '--surface': palette.surface,
    '--surface-soft': palette.surface,
    '--text-primary': palette.text,
    '--text-secondary': palette.text,
    '--border': `color-mix(in srgb, ${palette.text} 35%, ${palette.background})`,
    '--primary': palette.text,
    '--secondary': palette.primary,
    '--secondary-hover': `color-mix(in srgb, ${palette.primary} 84%, ${hoverMix})`,
    '--on-secondary': onPrimary,
    '--on-secondary-hover': onPrimary,
    '--accent': palette.primary,
    '--accent-text': palette.primary,
    '--accent-text-on-paper': palette.primary,
    '--shell-fg': palette.text,
    '--shell-fg-muted': palette.text,
    '--shell-dot': `color-mix(in srgb, ${palette.text} 14%, transparent)`,
    '--shell-rule': `color-mix(in srgb, ${palette.primary} 20%, transparent)`,
    '--press-surface': palette.surface,
    '--press-fg': palette.text,
    '--press-fg-muted': palette.text,
    '--press-border': `color-mix(in srgb, ${palette.text} 35%, ${palette.background})`,
    '--press-accent': palette.primary,
    '--press-paper': palette.surface,
    '--press-paper-muted': palette.surface,
    '--shadow': `4px 4px 0 color-mix(in srgb, ${palette.text} 22%, transparent)`,
    '--public-bg': palette.background,
    '--public-surface': palette.surface,
    '--public-soft': palette.surface,
    '--public-ink': palette.text,
    '--public-muted': palette.text,
    '--public-border': `color-mix(in srgb, ${palette.text} 35%, ${palette.background})`,
    '--public-action': palette.primary,
    '--public-on-action': onPrimary,
    '--public-accent': palette.primary,
    '--public-shadow': `color-mix(in srgb, ${palette.text} 28%, transparent)`,
    '--public-readable-glass-surface': palette.surface,
    '--public-readable-glass-foreground': palette.text,
    '--public-card-text-surface': palette.surface,
    '--public-card-text-foreground': palette.text,
    '--public-card-meta-surface': palette.surface,
    '--public-card-meta-foreground': palette.text,
    '--public-card-back-surface': palette.surface,
    '--public-card-back-tint': palette.surface,
    '--public-card-frame': palette.primary,
    '--public-hero-glass-surface': palette.surface,
    '--public-hero-glass-foreground': palette.text,
    '--public-card-action-fill': palette.primary,
    '--public-card-focus-surface': palette.surface,
    '--public-card-focus-ring': palette.text,
  };
}
