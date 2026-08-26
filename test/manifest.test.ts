import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * That the home-screen icon is not a broken image.
 *
 * None of this is exercised by running the app: a manifest is read by the
 * browser when someone installs it, long after anyone would have noticed. A
 * renamed icon, a size that does not match what it claims, a file left behind
 * in `public` — all of them survive every other test here and show up as a grey
 * square on a phone.
 */
const PUBLIC = join(process.cwd(), 'public');

interface Icon {
  src: string;
  sizes: string;
  type: string;
  purpose: string;
}

interface Manifest {
  name: string;
  start_url: string;
  scope: string;
  display: string;
  icons: Icon[];
}

function manifest(): Manifest {
  return JSON.parse(readFileSync(join(PUBLIC, 'manifest.webmanifest'), 'utf8')) as Manifest;
}

/** Width and height out of a PNG's header, which is the first thing in it. */
function pngSize(path: string): { width: number; height: number } {
  const header = readFileSync(path).subarray(16, 24);

  return { width: header.readUInt32BE(0), height: header.readUInt32BE(4) };
}

describe('the web app manifest', () => {
  it('is valid JSON and asks to open without browser chrome', () => {
    const read = manifest();

    expect(read.name).toBe('Kaleidoscope');
    expect(read.display).toBe('standalone');
  });

  // Absolute ones would resolve against the domain root, which is not where
  // this is served from — the same reason Vite is set to a relative `base`.
  it('keeps its paths relative, since it is served from a subpath', () => {
    const read = manifest();

    expect(read.start_url).toBe('./');
    expect(read.scope).toBe('./');

    for (const icon of read.icons) {
      expect(icon.src.startsWith('./')).toBe(true);
    }
  });

  it('points at icons that exist, at the sizes it claims', () => {
    for (const icon of manifest().icons) {
      const path = join(PUBLIC, icon.src.replace('./', ''));

      expect(statSync(path).isFile()).toBe(true);

      const [wanted] = icon.sizes.split('x').map(Number);
      const { width, height } = pngSize(path);

      expect({ src: icon.src, width, height }).toEqual({
        src: icon.src,
        width: wanted,
        height: wanted,
      });
    }
  });

  it('offers a maskable icon as well as a plain one', () => {
    const purposes = manifest().icons.map((icon) => icon.purpose);

    expect(purposes).toContain('any');
    // Without one, Android crops a square icon to its own shape and takes the
    // rim of the figure with it.
    expect(purposes).toContain('maskable');
  });

  it('has the icon iOS looks for, which is not in the manifest at all', () => {
    expect(statSync(join(PUBLIC, 'apple-touch-icon.png')).isFile()).toBe(true);
    expect(pngSize(join(PUBLIC, 'apple-touch-icon.png'))).toEqual({ width: 180, height: 180 });
  });

  it('ships nothing in public that nothing points at', () => {
    const referenced = new Set([
      ...manifest().icons.map((icon) => icon.src.replace('./', '')),
      'manifest.webmanifest',
      'apple-touch-icon.png',
      'favicon.png',
    ]);

    expect(readdirSync(PUBLIC).filter((file) => !referenced.has(file))).toEqual([]);
  });
});
