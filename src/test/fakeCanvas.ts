import { vi } from 'vitest';

/**
 * A minimal stand-in for `CanvasRenderingContext2D`.
 *
 * jsdom ships no canvas implementation, so drawing code is exercised against
 * this recorder instead. It answers the question the tests actually care about
 * — *what* was drawn, and how often — without pulling in a native dependency.
 */
export interface FakeContext extends Record<string, unknown> {
  calls: string[];
  countOf: (method: string) => number;
}

const METHODS = [
  'save',
  'restore',
  'translate',
  'rotate',
  'scale',
  'setTransform',
  'beginPath',
  'closePath',
  'moveTo',
  'lineTo',
  'arc',
  'quadraticCurveTo',
  'fill',
  'stroke',
  'clip',
  'fillRect',
  'clearRect',
  'drawImage',
] as const;

export function createFakeContext(): FakeContext {
  const calls: string[] = [];
  const context = {
    calls,
    countOf: (method: string) => calls.filter((call) => call === method).length,
    canvas: { width: 0, height: 0 },
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
  } as unknown as FakeContext;

  for (const method of METHODS) {
    context[method] = vi.fn(() => {
      calls.push(method);
    });
  }

  return context;
}

/** Casts the recorder for APIs that demand the real context type. */
export function asContext(context: FakeContext): CanvasRenderingContext2D {
  return context as unknown as CanvasRenderingContext2D;
}
