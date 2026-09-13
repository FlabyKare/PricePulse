import assert from "node:assert/strict";
import test from "node:test";
import { generateSurprisePalette, hslToHex } from "../lib/palette-generator.ts";

function seededRandom(seed = 7) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

test("surprise themes generate valid and varied palette values", () => {
  const random = seededRandom();
  const ids = new Set();
  for (let index = 0; index < 100; index += 1) {
    const palette = generateSurprisePalette(random);
    ids.add(palette.id);
    assert.match(palette.name, /сюрприз/);
    for (const key of ["paper", "ink", "surface", "card", "accent", "accent2", "accent3"]) assert.match(palette[key], /^#[0-9a-f]{6}$/i);
  }
  assert.ok(ids.size > 95);
});

test("HSL conversion normalizes hue", () => {
  assert.equal(hslToHex(0, 100, 50), "#ff0000");
  assert.equal(hslToHex(360, 100, 50), "#ff0000");
  assert.equal(hslToHex(120, 100, 50), "#00ff00");
});
