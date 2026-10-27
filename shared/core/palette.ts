export type AccentName = 'blue' | 'purple' | 'green' | 'orange' | 'red' | 'pink' | 'gray';

export const ACCENT_NAMES: AccentName[] = ['blue', 'purple', 'green', 'orange', 'red', 'pink', 'gray'];

export function isAccentName(value: unknown): value is AccentName {
  return typeof value === 'string' && ACCENT_NAMES.indexOf(value as AccentName) !== -1;
}

export type Rgb = [number, number, number];

interface AccentDefinition {
  base: Rgb;
  darkBase?: Rgb;
  dim: Rgb;
}

/**
 * Values taken from AniList's own `.user-page-unscoped.<color>` rules so the
 * global accent matches what the site shows inside a profile.
 */
const ACCENTS: Record<AccentName, AccentDefinition> = {
  blue: { base: [61, 180, 242], dim: [141, 178, 219] },
  purple: { base: [179, 104, 230], dim: [173, 141, 219] },
  green: { base: [74, 189, 78], dim: [141, 205, 144] },
  orange: { base: [239, 136, 26], darkBase: [218, 123, 21], dim: [249, 188, 124] },
  red: { base: [225, 51, 51], darkBase: [218, 65, 39], dim: [255, 136, 136] },
  pink: { base: [232, 95, 178], darkBase: [216, 120, 203], dim: [245, 173, 216] },
  gray: { base: [103, 123, 148], darkBase: [124, 137, 154], dim: [171, 186, 205] },
};

export const SHADE_STEPS: number[] = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

/** AniList's blue ramp; the shape of it is reused for every profile color. */
const BLUE_LIGHTNESS: number[] = [97.8, 96.1, 89.4, 78.0, 71.8, 59.2, 43.9, 34.9, 24.3, 19.8];

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function rgbToHsl(rgb: Rgb): Hsl {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function hslToRgb(hsl: Hsl): Rgb {
  const h = ((hsl.h % 360) + 360) % 360;
  const s = clamp(hsl.s, 0, 100) / 100;
  const l = clamp(hsl.l, 0, 100) / 100;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): number => {
    let value = t;
    if (value < 0) value += 1;
    if (value > 1) value -= 1;
    if (value < 1 / 6) return p + (q - p) * 6 * value;
    if (value < 1 / 2) return q;
    if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
    return p;
  };
  return [
    Math.round(channel(h / 360 + 1 / 3) * 255),
    Math.round(channel(h / 360) * 255),
    Math.round(channel(h / 360 - 1 / 3) * 255),
  ];
}

function buildShades(base: Rgb): Rgb[] {
  const hsl = rgbToHsl(base);
  const baseIndex = 5;
  const shades: Rgb[] = [];
  for (let index = 0; index < BLUE_LIGHTNESS.length; index += 1) {
    if (index === baseIndex) {
      shades.push(base);
      continue;
    }
    let lightness: number;
    let saturationFactor: number;
    if (index < baseIndex) {
      const t = (BLUE_LIGHTNESS[index] - BLUE_LIGHTNESS[baseIndex]) / (BLUE_LIGHTNESS[0] - BLUE_LIGHTNESS[baseIndex]);
      lightness = hsl.l + t * (98 - hsl.l);
      saturationFactor = 1 - 0.22 * t;
    } else {
      const t = (BLUE_LIGHTNESS[baseIndex] - BLUE_LIGHTNESS[index]) / (BLUE_LIGHTNESS[baseIndex] - BLUE_LIGHTNESS[9]);
      lightness = hsl.l - t * (hsl.l - 18);
      saturationFactor = 1 - 0.05 * t;
    }
    shades.push(hslToRgb({ h: hsl.h, s: hsl.s * saturationFactor, l: lightness }));
  }
  return shades;
}

export interface AccentPalette {
  base: Rgb;
  dim: Rgb;
  shades: Rgb[];
}

export function accentPalette(name: AccentName, dark: boolean): AccentPalette {
  const definition = ACCENTS[name];
  const base = dark && definition.darkBase ? definition.darkBase : definition.base;
  return {
    base,
    dim: definition.dim,
    shades: buildShades(base),
  };
}

export function rgbTriplet(rgb: Rgb): string {
  return rgb[0] + ',' + rgb[1] + ',' + rgb[2];
}

export function accentLabel(name: AccentName): string {
  return name.charAt(0).toUpperCase() + name.slice(1);
}

export function isDarkTheme(): boolean {
  const classes = document.body ? document.body.className : '';
  return /(^|\s)site-theme-(dark|contrast)(\s|$)/.test(classes);
}
