export type GeneratedPalette = {
  id: string;
  name: string;
  paper: string;
  ink: string;
  surface: string;
  card: string;
  accent: string;
  accent2: string;
  accent3: string;
};

const paletteNames = ["Аврора", "Глубина", "Северное сияние", "Малахит", "Космос", "Лагуна", "Орхидея", "Мандарин", "Ультрамарин", "Мята"];

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

export function hslToHex(hue: number, saturation: number, lightness: number) {
  const h = ((hue % 360) + 360) % 360;
  const s = clamp(saturation, 0, 100) / 100;
  const l = clamp(lightness, 0, 100) / 100;
  const chroma = (1 - Math.abs(2 * l - 1)) * s;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const offset = l - chroma / 2;
  const [red, green, blue] = h < 60 ? [chroma, x, 0]
    : h < 120 ? [x, chroma, 0]
      : h < 180 ? [0, chroma, x]
        : h < 240 ? [0, x, chroma]
          : h < 300 ? [x, 0, chroma]
            : [chroma, 0, x];
  return `#${[red, green, blue].map((channel) => Math.round((channel + offset) * 255).toString(16).padStart(2, "0")).join("")}`;
}

/** Builds a high-contrast UI palette around an analogous or split-complementary harmony. */
export function generateSurprisePalette(random: () => number = Math.random): GeneratedPalette {
  const hue = Math.floor(random() * 360);
  const dark = random() < 0.42;
  const splitComplementary = random() < 0.5;
  const hue2 = hue + (splitComplementary ? 150 : 42);
  const hue3 = hue + (splitComplementary ? 210 : 78);
  const accentLightness = dark ? 67 : 58;
  const name = paletteNames[Math.floor(random() * paletteNames.length) % paletteNames.length];
  const nonce = `${Date.now().toString(36)}-${Math.floor(random() * 1_000_000).toString(36)}`;

  return {
    id: `surprise-${nonce}`,
    name: `${name} · сюрприз`,
    paper: hslToHex(hue, dark ? 24 : 28, dark ? 7 : 96),
    ink: hslToHex(hue, dark ? 18 : 32, dark ? 95 : 9),
    surface: hslToHex(hue, dark ? 28 : 32, dark ? 13 : 10),
    card: hslToHex(hue + 8, dark ? 22 : 16, dark ? 11 : 99),
    accent: hslToHex(hue, dark ? 78 : 82, accentLightness),
    accent2: hslToHex(hue2, dark ? 72 : 76, accentLightness + (dark ? -2 : 1)),
    accent3: hslToHex(hue3, dark ? 68 : 72, accentLightness + (dark ? 3 : -1)),
  };
}
