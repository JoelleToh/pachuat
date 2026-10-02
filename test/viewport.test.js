// test/viewport.test.js
//
// Asserts the viewport meta configuration in index.html scales the game to the
// device width, pins the initial scale to 1.0, and disables user-initiated zoom
// so pinch / double-tap zoom cannot disrupt gameplay (task 16.3).
//
// Requirements: 10.3, 10.4

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexHtmlPath = resolve(__dirname, '..', 'index.html');

/**
 * Extracts the `content` attribute of the `<meta name="viewport">` tag.
 * Tolerant of attribute ordering, arbitrary whitespace/newlines between
 * attributes, and either single or double quotes.
 *
 * @param {string} html
 * @returns {string|null}
 */
function extractViewportContent(html) {
  // Match a <meta ...> tag that carries name="viewport" (in any attribute order)
  // and capture its content attribute value.
  const metaTags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of metaTags) {
    if (!/name\s*=\s*(['"])viewport\1/i.test(tag)) continue;
    const content = tag.match(/content\s*=\s*(['"])(.*?)\1/is);
    if (content) return content[2].replace(/\s+/g, ' ').trim();
  }
  return null;
}

describe('viewport meta configuration', () => {
  const html = readFileSync(indexHtmlPath, 'utf8');
  const content = extractViewportContent(html);

  it('declares a <meta name="viewport"> with a content attribute', () => {
    expect(content).not.toBeNull();
  });

  it('scales to the device width (Req 10.3)', () => {
    expect(content).toContain('width=device-width');
  });

  it('pins the initial scale to 1.0 (Req 10.3)', () => {
    expect(content).toContain('initial-scale=1.0');
  });

  it('disables user-initiated zoom (Req 10.4)', () => {
    expect(content).toContain('user-scalable=no');
  });

  it('includes all three required directives together', () => {
    expect(content).toEqual(
      expect.stringMatching(/width=device-width/),
    );
    expect(content).toEqual(expect.stringMatching(/initial-scale=1\.0/));
    expect(content).toEqual(expect.stringMatching(/user-scalable=no/));
  });
});
