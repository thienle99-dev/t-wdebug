import { describe, expect, it } from 'vitest';
import { calculateScreenshotCrop } from './component-snapshot';

const viewport = { width: 1000, height: 800, devicePixelRatio: 2 };

describe('component screenshot crop coordinates', () => {
  it('uses actual screenshot-to-viewport scale for browser zoom and DPR', () => {
    const crop = calculateScreenshotCrop({ x: 100, y: 40, width: 120, height: 50 }, viewport, { width: 2500, height: 2000 }, 'element');
    expect(crop).toMatchObject({ x: 250, y: 100, width: 300, height: 125, partial: false });
  });

  it('adds context padding in CSS pixels and clamps it to the viewport', () => {
    const crop = calculateScreenshotCrop({ x: 5, y: 6, width: 30, height: 20 }, viewport, { width: 2000, height: 1600 }, 'context', 16);
    expect(crop).toMatchObject({ x: 0, y: 0, width: 102, height: 84, partial: false });
  });

  it('captures only the visible intersection and marks partially offscreen elements', () => {
    const crop = calculateScreenshotCrop({ x: -20, y: 790, width: 100, height: 40 }, viewport, { width: 2000, height: 1600 }, 'element');
    expect(crop).toMatchObject({ x: 0, y: 1580, width: 160, height: 20, partial: true, visibleBounds: { x: 0, y: 790, width: 80, height: 10 } });
  });

  it('uses the complete visible screenshot for viewport mode', () => {
    expect(calculateScreenshotCrop({ x: 0, y: 0, width: 50, height: 50 }, viewport, { width: 2000, height: 1600 }, 'viewport')).toMatchObject({ x: 0, y: 0, width: 2000, height: 1600, partial: false });
  });

  it('rejects elements that are fully outside the visible viewport', () => {
    expect(() => calculateScreenshotCrop({ x: 0, y: 900, width: 50, height: 50 }, viewport, { width: 2000, height: 1600 }, 'element')).toThrow(/outside the visible viewport/);
  });
});
