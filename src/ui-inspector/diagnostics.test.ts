import { describe, expect, it } from 'vitest';
import { classifyInteraction, evaluateLayoutDiagnostics, type LayoutDiagnosticFacts } from './diagnostics';

const base: LayoutDiagnosticFacts = {
  selector: 'button#save', display: 'block', position: 'relative', visibility: 'visible', opacity: 1,
  width: 120, height: 40, viewportWidth: 1280, viewportHeight: 800, documentWidth: 1280,
  inViewport: true, hiddenBy: [], coveredSamples: 0, testedSamples: 9, pointerEvents: 'auto',
  disabled: false, ariaDisabled: false, interactive: true, keyboardReachable: true, accessibleName: true,
  minWidth: 'auto', maxWidth: 'none', stickyTop: 'auto', stickyBottom: 'auto', scrollAncestorSelectors: [],
  flexShrink: '1', minWidthAuto: false,
};

describe('UI layout diagnostics', () => {
  it('reports ancestor hiding, clipping, and sampled coverage with evidence', () => {
    const results = evaluateLayoutDiagnostics({ ...base, hiddenBy: ['.modal'], clippingSelector: '.viewport', coveringSelector: '.loading-overlay', coveredSamples: 8 });
    expect(results.map((item) => item.title)).toContain('Element is visually hidden');
    expect(results.find((item) => item.title === 'Element is visually hidden')?.evidence).toContain('.modal');
    expect(results.map((item) => item.title)).toContain('Element is clipped by an ancestor');
    expect(results.find((item) => item.title === 'Element is likely covered')?.evidence).toContain('8/9');
  });

  it('detects flex, grid, sticky, fixed-containing-block, and overflow conditions', () => {
    const titles = evaluateLayoutDiagnostics({
      ...base, width: 500, parentWidth: 300, parentDisplay: 'flex', parentSelector: '.row', minWidthAuto: true, contentOverflows: true,
      flexShrink: '1', documentWidth: 1400, viewportWidth: 1280, position: 'sticky', scrollAncestorSelectors: ['.inner', '.page'],
    }).map((item) => item.title);
    expect(titles).toContain('Element overflows its parent horizontally');
    expect(titles).toContain('Page has horizontal overflow');
    expect(titles).toContain('Possible flex min-width:auto issue');
    expect(titles).toContain('Sticky positioning has no inset');
    expect(titles).toContain('Sticky uses a nested scroll chain');

    const gridAndFixed = evaluateLayoutDiagnostics({ ...base, parentDisplay: 'grid', parentWidth: 90, gridColumns: '90px', position: 'fixed', fixedContainingBlock: '.app-shell' }).map((item) => item.title);
    expect(gridAndFixed).toContain('Possible grid overflow');
    expect(gridAndFixed).toContain('Fixed positioning is scoped by an ancestor');
  });

  it('classifies strong and partial blockers without overstating uncertain coverage', () => {
    expect(classifyInteraction({ hidden: false, disabled: false, pointerEvents: 'auto', coveredSamples: 8, testedSamples: 9 }).state).toBe('blocked');
    expect(classifyInteraction({ hidden: false, disabled: false, pointerEvents: 'auto', coveredSamples: 3, testedSamples: 9 }).state).toBe('possible');
    expect(classifyInteraction({ hidden: false, disabled: false, pointerEvents: 'auto', coveredSamples: 0, testedSamples: 9 }).state).toBe('available');
    expect(classifyInteraction({ hidden: false, disabled: true, pointerEvents: 'auto', coveredSamples: 0, testedSamples: 9 }).reasons).toContain('disabled');
  });
});
