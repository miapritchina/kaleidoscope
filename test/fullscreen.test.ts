import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * That the artwork reaches the edges of a phone.
 *
 * This is read rather than rendered, for the same reason the manifest is: none
 * of it is exercised by running the app anywhere a test can run. jsdom has no
 * viewport, no safe areas and no home-screen mode, and a desktop browser
 * measures every one of these units the same — so the only place the difference
 * shows is on a phone, where nobody is looking until a band of page background
 * appears along the bottom of the picture. Which it did: 793pt of page on an
 * iPhone 15 Pro's 852pt screen, short by the 59pt the Dynamic Island's inset
 * takes, with the missing strip showing as a dark band under the figure.
 *
 * So these guard the two things that fix stayed on, both of which look like
 * tidying-up to anyone who did not see the band.
 */
const SOURCE = join(process.cwd(), 'src');

const read = (name: string) => readFileSync(join(SOURCE, name), 'utf8');

describe('filling the screen on a phone', () => {
  it('lets the artwork run under the status bar and the home indicator', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

    // Without this iOS insets the whole page by the safe areas and the picture
    // comes up with a band above it as well as below.
    expect(html).toMatch(/viewport-fit=cover/);
  });

  it('measures a home-screen app against the whole screen, not the page box', () => {
    const css = read('index.css');
    const standalone = /@media \(display-mode: standalone\)\s*\{([^}]*\{[^}]*\})*[^}]*\}/.exec(css);

    expect(standalone?.[0]).toBeDefined();
    // The units disagree in standalone about whether the strip under the status
    // bar belongs to the page, and `100%` alone is the one that says no. Taking
    // the largest can only ever add to what the page already covered — nothing
    // collapses in standalone, so none of them can overshoot the screen.
    expect(standalone?.[0]).toMatch(/max\(\s*100%,\s*100vh,\s*100dvh\s*\)/);
  });

  it('pins the artwork to the viewport rather than to the page', () => {
    const css = read('App.module.css');
    const stage = /\.stage \{[^}]*\}/.exec(css);

    // A fixed box is measured against the viewport, which is a different
    // question from how tall the page came out — and the artwork is the one
    // thing that has to reach the edge whatever the answer.
    expect(stage?.[0]).toMatch(/position:\s*fixed/);
    expect(stage?.[0]).toMatch(/inset:\s*0/);
  });
});
