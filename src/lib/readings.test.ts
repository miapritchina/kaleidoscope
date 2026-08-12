import { describe, expect, it } from 'vitest';

import { readoutLines, type DeviceReadings } from './readings';

const NOTHING: DeviceReadings = { orientation: null, motion: null, supported: true };

describe('readoutLines', () => {
  it('writes out the accelerometer', () => {
    const lines = readoutLines({ ...NOTHING, motion: { x: 0.12, y: -9.71, z: 0.4 } }, null);

    expect(lines[0]).toContain('x  +0.12');
    expect(lines[0]).toContain('y  -9.71');
    expect(lines[0]).toContain('z  +0.40');
  });

  it('writes out how the device is held', () => {
    const lines = readoutLines(
      { ...NOTHING, orientation: { alpha: 12, beta: 88, gamma: -3 } },
      null,
    );

    expect(lines[0]).toContain('β  +88');
    expect(lines[0]).toContain('γ   -3');
  });

  // The whole use of the readout: what the sensors say, beside what the app has
  // made of it. When those two disagree the difference is the bug.
  it('shows where the app has decided down is, beside the readings', () => {
    const lines = readoutLines({ ...NOTHING, orientation: { alpha: 0, beta: 90, gamma: 0 } }, 0);

    // Held upright, all of gravity is still in the plane of the screen.
    expect(lines.at(-1)).toBe('down   +0 deg  100%');
  });

  // The direction is only worth as much as what is left of gravity on screen:
  // laid flat there is none of it, and down points through the glass instead.
  it('says how much of gravity the screen still has, and when it has none', () => {
    const upright = readoutLines({ ...NOTHING, orientation: { alpha: 0, beta: 90, gamma: 0 } }, 0);
    const flat = readoutLines({ ...NOTHING, orientation: { alpha: 0, beta: 2, gamma: 0 } }, 0);

    expect(upright.at(-1)).toContain('100%');
    expect(upright.at(-1)).not.toContain('flat');
    expect(flat.at(-1)).toContain('flat');
  });

  it('leaves that line out when nothing is asking for it', () => {
    const lines = readoutLines({ ...NOTHING, orientation: { alpha: 0, beta: 90, gamma: 0 } }, null);

    expect(lines.some((line) => line.startsWith('down'))).toBe(false);
  });

  // A column that jumps sideways whenever a value crosses zero cannot be read,
  // however often it is refreshed.
  it('keeps the columns still across a sign change', () => {
    const positive = readoutLines({ ...NOTHING, motion: { x: 1, y: 2, z: 3 } }, null)[0]!;
    const negative = readoutLines({ ...NOTHING, motion: { x: -1, y: -2, z: -3 } }, null)[0]!;

    expect(negative).toHaveLength(positive.length);
    expect(negative.indexOf('y')).toBe(positive.indexOf('y'));
  });

  it('says so when there is nothing to read yet', () => {
    expect(readoutLines(NOTHING, null)).toEqual([
      'no readings yet — on iOS, switch on Real gravity',
    ]);
  });

  it('says so when the device has no such sensors', () => {
    expect(readoutLines({ ...NOTHING, supported: false }, null)).toEqual([
      'no motion sensors on this device',
    ]);
  });

  it('does not print a number for a reading that is not one', () => {
    const lines = readoutLines(
      { ...NOTHING, motion: { x: Number.NaN, y: 0, z: Number.POSITIVE_INFINITY } },
      null,
    );

    expect(lines[0]).toContain('x —');
    expect(lines[0]).toContain('z —');
  });
});
