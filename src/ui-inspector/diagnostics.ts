export interface LayoutDiagnosticFacts {
  selector: string;
  display: string;
  position: string;
  visibility: string;
  opacity: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  documentWidth: number;
  parentSelector?: string;
  parentDisplay?: string;
  parentWidth?: number;
  contentOverflows?: boolean;
  parentOverflowX?: string;
  parentOverflowY?: string;
  inViewport: boolean;
  clippingSelector?: string;
  hiddenBy: string[];
  coveringSelector?: string;
  coveredSamples: number;
  testedSamples: number;
  pointerEvents: string;
  disabled: boolean;
  ariaDisabled: boolean;
  interactive: boolean;
  keyboardReachable: boolean;
  accessibleName: boolean;
  minWidth: string;
  maxWidth: string;
  stickyTop: string;
  stickyBottom: string;
  fixedContainingBlock?: string;
  stackingContextConflict?: string;
  scrollAncestorSelectors: string[];
  flexShrink: string;
  minWidthAuto: boolean;
  gridColumns?: string;
}

export interface UIDiagnostic { severity: 'info' | 'warning' | 'error'; title: string; evidence: string }

export function evaluateLayoutDiagnostics(facts: LayoutDiagnosticFacts): UIDiagnostic[] {
  const output: UIDiagnostic[] = [];
  if (facts.display === 'none') output.push(warning('Element is not displayed', `${facts.selector} has display:none`));
  if (facts.visibility !== 'visible' || facts.opacity === 0 || facts.hiddenBy.length) output.push(warning('Element is visually hidden', facts.hiddenBy.length ? `Hidden by: ${facts.hiddenBy.join(' → ')}` : `visibility:${facts.visibility}; opacity:${facts.opacity}`));
  if (facts.width <= 0 || facts.height <= 0) output.push(warning('Element has zero size', `${facts.width} × ${facts.height} CSS pixels`));
  if (!facts.inViewport) output.push(warning('Element is outside the viewport', `${facts.width} × ${facts.height} element · ${facts.viewportWidth} × ${facts.viewportHeight} viewport`));
  if (facts.clippingSelector) output.push(warning('Element is clipped by an ancestor', `${facts.clippingSelector} clips the selected bounds`));
  if (facts.coveringSelector && facts.testedSamples > 0) {
    const ratio = facts.coveredSamples / facts.testedSamples;
    if (ratio >= 0.25) output.push(warning(ratio >= 0.8 ? 'Element is likely covered' : 'Element may be partially covered', `${facts.coveringSelector} was topmost at ${facts.coveredSamples}/${facts.testedSamples} visible sample points`));
  }
  if (facts.pointerEvents === 'none') output.push(warning('Pointer events are disabled', 'The selected element has pointer-events:none'));
  if (facts.disabled || facts.ariaDisabled) output.push({ severity: 'info', title: 'Element is disabled', evidence: facts.disabled ? 'Native disabled state is set' : 'aria-disabled="true" is set' });
  if (facts.interactive && !facts.keyboardReachable) output.push(warning('Interactive element is not keyboard reachable', 'No tabindex or native keyboard-interactive semantics were detected'));
  if (facts.interactive && !facts.accessibleName) output.push(warning('Interactive element has no accessible name', facts.selector));
  if (facts.parentWidth !== undefined && facts.width > facts.parentWidth + 1) output.push(warning('Element overflows its parent horizontally', `${Math.round(facts.width)}px element · ${Math.round(facts.parentWidth)}px parent`));
  if (facts.documentWidth > facts.viewportWidth + 1) output.push(warning('Page has horizontal overflow', `${facts.documentWidth}px document · ${facts.viewportWidth}px viewport`));
  if (facts.parentDisplay === 'flex' || facts.parentDisplay === 'inline-flex') {
    if (facts.minWidthAuto && facts.contentOverflows) output.push(warning('Possible flex min-width:auto issue', 'The item has min-width:auto and its scroll width exceeds its client width; it may refuse to shrink below its content size'));
    if (facts.flexShrink === '1' && facts.parentWidth !== undefined && facts.width < facts.parentWidth) output.push({ severity: 'info', title: 'Flex item may be shrinking', evidence: `flex-shrink:1 · parent ${Math.round(facts.parentWidth)}px` });
  }
  if ((facts.parentDisplay === 'grid' || facts.parentDisplay === 'inline-grid') && (facts.parentWidth !== undefined && facts.width > facts.parentWidth + 1 || facts.contentOverflows)) output.push(warning('Possible grid overflow', `${facts.width}px item${facts.parentWidth !== undefined ? ` in ${facts.parentWidth}px container` : ''}${facts.contentOverflows ? ' has overflowing content' : ''}${facts.gridColumns ? ` · columns ${facts.gridColumns}` : ''}`));
  if (facts.position === 'sticky' && facts.stickyTop === 'auto' && facts.stickyBottom === 'auto') output.push(warning('Sticky positioning has no inset', 'Both top and bottom are auto; sticky may not engage on this axis'));
  if (facts.position === 'sticky' && facts.scrollAncestorSelectors.length > 1) output.push({ severity: 'info', title: 'Sticky uses a nested scroll chain', evidence: facts.scrollAncestorSelectors.join(' → ') });
  if (facts.position === 'fixed' && facts.fixedContainingBlock) output.push(warning('Fixed positioning is scoped by an ancestor', `${facts.fixedContainingBlock} establishes a fixed-position containing block`));
  if (facts.stackingContextConflict) output.push(warning('Element is inside a lower stacking context', facts.stackingContextConflict));
  return output;
}

export function classifyInteraction(input: { hidden: boolean; disabled: boolean; pointerEvents: string; coveredSamples: number; testedSamples: number }): { state: 'available' | 'blocked' | 'possible'; reasons: string[] } {
  const reasons: string[] = [];
  if (input.hidden) reasons.push('not visible');
  if (input.disabled) reasons.push('disabled');
  if (input.pointerEvents === 'none') reasons.push('pointer-events:none');
  const coverage = input.testedSamples > 0 ? input.coveredSamples / input.testedSamples : 0;
  if (coverage >= 0.8) reasons.push('likely covered by another element');
  else if (coverage >= 0.25) reasons.push('possibly covered at some sample points');
  const blocked = input.hidden || input.disabled || input.pointerEvents === 'none' || coverage >= 0.8;
  return { state: blocked ? 'blocked' : coverage >= 0.25 ? 'possible' : 'available', reasons };
}

function warning(title: string, evidence: string): UIDiagnostic { return { severity: 'warning', title, evidence }; }
