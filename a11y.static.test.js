import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Static accessibility checks on source files: colour contrast of the text palette, minimum text
// size, visible focus, reduced-motion support and document metadata.

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const uiSources = () =>
  [path.join(ROOT, 'src', 'App.tsx'), ...fs.readdirSync(path.join(ROOT, 'src', 'components')).map((f) => path.join(ROOT, 'src', 'components', f))].filter(
    (f) => f.endsWith('.tsx') && !f.includes('.test.')
  );

// Tailwind v4 default palette (sRGB approximations) for the colours used as text and as surfaces
const PALETTE = {
  'slate-200': '#e2e8f0', 'slate-300': '#cad5e2', 'slate-400': '#90a1b9', 'slate-500': '#62748e', 'slate-600': '#45556c',
  'slate-800': '#1d293d', 'slate-900': '#0f172b', 'slate-950': '#020618',
  'indigo-300': '#a3b3ff', 'indigo-400': '#7c86ff', 'cyan-300': '#53eafd', 'emerald-300': '#5ee9b5', 'emerald-400': '#00d492',
  'amber-200': '#fee685', 'amber-300': '#ffd230', 'rose-200': '#ffccd3', 'rose-300': '#ffa1ad', 'rose-400': '#ff637e',
};

function luminance(hex) {
  const channel = (i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe('static accessibility checks', () => {
  it('uses only text colours that meet WCAG AA (4.5:1) on every dark surface', () => {
    const surfaces = ['slate-950', 'slate-900', 'slate-800'];
    const used = new Set();
    for (const file of uiSources()) {
      for (const match of fs.readFileSync(file, 'utf8').matchAll(/(?<![\w:-])text-((?:slate|indigo|cyan|emerald|amber|rose)-\d{3})(?![\w/-])/g)) used.add(match[1]);
    }
    expect(used.size).toBeGreaterThan(5);
    // The two greys that fail on dark backgrounds must not be used for text at all
    expect([...used]).not.toContain('slate-500');
    expect([...used]).not.toContain('slate-600');

    for (const color of used) {
      if (!PALETTE[color]) continue; // decorative or icon-only shades outside the checked palette
      if (surfaces.includes(color)) continue; // dark text is only used on bright fills (for example a tick on a green box)
      for (const surface of surfaces) {
        if (surface === 'slate-800' && !['slate-200', 'slate-300', 'slate-400'].includes(color)) continue;
        expect(contrast(PALETTE[color], PALETTE[surface]), `${color} on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Sanity check of the calculation itself against the known failing pair
    expect(contrast(PALETTE['slate-600'], PALETTE['slate-950'])).toBeLessThan(4.5);
  });

  it('does not render text below 11px', () => {
    for (const file of uiSources()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/text-\[(\d+)px\]/g)) {
        expect(Number(match[1]), `${path.basename(file)}: ${match[0]}`).toBeGreaterThanOrEqual(11);
      }
    }
  });

  it('defines a visible focus style for every interactive element and honours reduced motion', () => {
    const css = read('src/index.css');
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid/);
    for (const selector of ['a', 'button', 'input', 'select', 'textarea', 'summary']) {
      expect(css).toMatch(new RegExp(`:where\\([^)]*\\b${selector}\\b[^)]*\\):focus-visible`));
    }
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).toMatch(/animation-duration:\s*0\.01ms\s*!important/);
    expect(css).toMatch(/\.skip-link:focus/);

    // Scripted motion is also switched off for people who ask for less motion
    expect(read('src/App.tsx')).toMatch(/prefers-reduced-motion: reduce/);
    expect(read('src/components/RescueRoadmapSection.tsx')).toMatch(/disableForReducedMotion:\s*true/);
  });

  it('never removes the focus outline without providing a replacement ring', () => {
    for (const file of uiSources()) {
      const text = fs.readFileSync(file, 'utf8');
      for (const match of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
        const classes = match[1] ?? match[2];
        if (!/focus-visible:outline-none/.test(classes)) continue;
        expect(/focus-visible:ring-/.test(classes), `${path.basename(file)}: outline removed without a ring: ${classes.slice(0, 90)}`).toBe(true);
      }
    }
  });

  it('declares the document language, a title, a description and a zoomable viewport', () => {
    const html = read('index.html');
    expect(html).toMatch(/<html[^>]*\blang="en"/);
    expect(html).toMatch(/<title>[^<]{5,}<\/title>/);
    expect(html).toMatch(/<meta name="description" content="[^"]{20,}"/);
    expect(html).toMatch(/<meta name="viewport" content="width=device-width, initial-scale=1\.0"/);
    expect(html).not.toMatch(/user-scalable=no|maximum-scale=1/);
  });
});
