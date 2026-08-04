import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

// jsdom implements neither of these; the components only need them to exist.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// jsdom has no canvas backend and logs a "not implemented" error for every
// getContext call. Returning null is the same outcome, minus the noise — the
// components are expected to cope with a context that never materialises.
HTMLCanvasElement.prototype.getContext = vi.fn(() => null);

if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {
      // No layout in jsdom, so there is nothing to report.
    }
    unobserve() {
      // See observe().
    }
    disconnect() {
      // See observe().
    }
  };
}
