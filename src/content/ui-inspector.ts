import type { UIElementRecord } from '../shared/types';
import { classifyInteraction, evaluateLayoutDiagnostics } from '../ui-inspector/diagnostics';

declare global { interface Window { __DEBUG_LENS_UI_INSPECTOR__?: boolean } }
if (!window.__DEBUG_LENS_UI_INSPECTOR__) {
  window.__DEBUG_LENS_UI_INSPECTOR__ = true;
  const overlay = document.createElement('div');
  const tag = document.createElement('div');
  overlay.dataset.debugLensInternal = 'overlay';
  Object.assign(overlay.style, { position: 'fixed', display: 'none', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #4388ff', background: 'rgba(67,136,255,.12)', boxSizing: 'border-box' });
  Object.assign(tag.style, { position: 'absolute', left: '-2px', top: '-24px', padding: '3px 6px', color: '#fff', background: '#2563eb', borderRadius: '3px', font: '11px/1.3 ui-monospace,monospace', whiteSpace: 'nowrap', maxWidth: 'min(420px,90vw)', overflow: 'hidden', textOverflow: 'ellipsis' });
  overlay.append(tag);
  let selected: Element | undefined;
  let inspectorStatus: 'idle' | 'picking' | 'selected' = 'idle';
  let observer: MutationObserver | undefined;
  let mutationCount = 0;
  let scheduled = false;
  let waitingForDocument = false;
  let latestPointer: { x: number; y: number } | undefined;

  chrome.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id || !rawMessage || typeof rawMessage !== 'object' || !('type' in rawMessage)) return;
    const type = rawMessage.type;
    if (type === 'GET_INSPECTOR_STATUS') {
      sendResponse({ ok: true, status: inspectorStatus });
      return;
    }
    if (type === 'START_UI_INSPECTOR') {
      try { startPicking(); sendResponse({ ok: true, status: inspectorStatus }); }
      catch { inspectorStatus = 'idle'; sendResponse({ ok: false, reason: 'inspector-start-failed' }); }
      return;
    }
    if (type === 'STOP_UI_INSPECTOR') {
      stopInspection(); sendResponse({ ok: true, status: inspectorStatus });
      return;
    }
    if (type === 'CAPTURE_SELECTED_ELEMENT') {
      if (!selected?.isConnected) { sendResponse({ ok: false, reason: 'no-selected-element' }); return; }
      sendRecord(snapshot(selected)); sendResponse({ ok: true, status: inspectorStatus });
    }
  });

  function startPicking() {
    stopInspection();
    selected = undefined;
    inspectorStatus = 'picking';
    mountOverlayWhenReady();
    document.addEventListener('pointermove', onPointerMove, true);
    document.addEventListener('click', onPickClick, true);
    document.addEventListener('keydown', onPickerKey, true);
    showToast('Pick an element · click to inspect · Esc to cancel');
  }
  function stopPicking() {
    document.removeEventListener('pointermove', onPointerMove, true);
    document.removeEventListener('click', onPickClick, true);
    document.removeEventListener('keydown', onPickerKey, true);
    if (!selected) overlay.style.display = 'none';
    if (!selected) inspectorStatus = 'idle';
  }
  function stopInspection() {
    stopPicking(); observer?.disconnect(); observer = undefined; selected = undefined;
    for (const type of trackedEvents) document.removeEventListener(type, onRelatedEvent, true);
    window.removeEventListener('scroll', onViewportChange, true); window.removeEventListener('resize', onViewportChange);
    overlay.style.display = 'none';
    inspectorStatus = 'idle';
    if (waitingForDocument) document.removeEventListener('DOMContentLoaded', mountOverlayWhenReady);
    waitingForDocument = false;
  }
  function mountOverlayWhenReady() {
    if (!document.documentElement) {
      if (!waitingForDocument) { waitingForDocument = true; document.addEventListener('DOMContentLoaded', mountOverlayWhenReady, { once: true }); }
      return;
    }
    waitingForDocument = false;
    if (!overlay.isConnected) document.documentElement.append(overlay);
  }
  function onPickerKey(event: KeyboardEvent) { if (event.key === 'Escape') { stopPicking(); event.stopImmediatePropagation(); } }
  function onPointerMove(event: PointerEvent) {
    latestPointer = { x: event.clientX, y: event.clientY };
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; const point = latestPointer; if (!point) return; const element = deepElementFromPoint(point.x, point.y); if (element && !overlay.contains(element) && !element.closest('[data-debug-lens-internal]')) drawOutline(element); });
  }
  function onPickClick(event: MouseEvent) {
    const element = deepElementFromPoint(event.clientX, event.clientY);
    if (!element || overlay.contains(element) || element.closest('[data-debug-lens-internal]')) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    selected = element; stopPicking();
    inspectorStatus = 'selected';
    const record = snapshot(element);
    sendRecord(record);
    beginObservation(element);
    const clickRecord = eventRecord('inspect', element);
    sendRecord(clickRecord);
    showToast(`${record.selector} · ${Math.round(record.bounds.width)} × ${Math.round(record.bounds.height)}`);
    drawOutline(element);
  }
  function drawOutline(element: Element) {
    const bounds = element.getBoundingClientRect();
    overlay.style.display = 'block'; overlay.style.left = `${bounds.left}px`; overlay.style.top = `${bounds.top}px`;
    overlay.style.width = `${Math.max(bounds.width, 1)}px`; overlay.style.height = `${Math.max(bounds.height, 1)}px`;
    tag.textContent = `${selectorFor(element)} · ${Math.round(bounds.width)} × ${Math.round(bounds.height)}`;
    tag.style.top = bounds.top < 30 ? '100%' : '-24px';
  }
  function onViewportChange() { if (selected?.isConnected) drawOutline(selected); else if (selected) overlay.style.display = 'none'; }
  function snapshot(element: Element): Omit<UIElementRecord, 'tabId'> {
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    const width = document.documentElement.clientWidth; const height = document.documentElement.clientHeight;
    const attrs: Record<string, string> = {};
    const sensitiveValue = element instanceof HTMLInputElement && (/password|token|secret|authorization|cookie|api.?key/i.test(`${element.type} ${element.name} ${element.id}`));
    for (const attribute of Array.from(element.attributes).slice(0, 80)) {
      if (attribute.name.toLowerCase() === 'value' && (sensitiveValue || element instanceof HTMLInputElement && element.type === 'password')) attrs[attribute.name] = '[REDACTED]';
      else attrs[attribute.name] = attribute.value.slice(0, 1000);
    }
    const computed: Record<string, string> = {};
    const properties = ['display','position','top','right','bottom','left','width','height','min-width','min-height','max-width','max-height','margin','margin-top','margin-right','margin-bottom','margin-left','padding','padding-top','padding-right','padding-bottom','padding-left','border','border-top-width','border-right-width','border-bottom-width','border-left-width','overflow','overflow-x','overflow-y','z-index','opacity','visibility','content-visibility','clip-path','pointer-events','transform','filter','perspective','isolation','mix-blend-mode','will-change','contain','font-size','line-height','color','background-color','background','white-space','text-overflow','box-sizing','flex','flex-grow','flex-shrink','flex-basis','order','align-self','grid','grid-column','grid-row','justify-self'];
    for (const property of properties) computed[property] = style.getPropertyValue(property);
    const ancestry: UIElementRecord['ancestry'] = [];
    for (let node = element.parentElement; node && ancestry.length < 6; node = node.parentElement) ancestry.push({ selector: simpleSelector(node), tagName: node.tagName.toLowerCase(), id: node.id || undefined, classes: Array.from(node.classList).slice(0, 8) });
    const variables: Record<string, string> = {};
    for (let node: Element | null = element; node && Object.keys(variables).length < 40; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      for (let index = 0; index < nodeStyle.length && Object.keys(variables).length < 40; index++) { const name = nodeStyle.item(index); if (name.startsWith('--') && variables[name] === undefined) variables[name] = nodeStyle.getPropertyValue(name).trim().slice(0, 300); }
    }
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
    const clipping = clippingAncestor(element, rect);
    const coverage = coverAtPoints(element, rect);
    const disabled = element.matches(':disabled');
    const ariaDisabled = element.getAttribute('aria-disabled') === 'true';
    const interactive = element.matches('button,a[href],input,select,textarea,summary,[role="button"],[role="link"],[tabindex]');
    const keyboardReachable = (element instanceof HTMLElement ? element.tabIndex >= 0 : element.hasAttribute('tabindex')) && (interactive || element.hasAttribute('tabindex'));
    const role = element.getAttribute('role') ?? implicitRole(element);
    const accessibleName = nameOf(element);
    const checks: string[] = [];
    if (!accessibleName && ['button','link','textbox','img'].includes(role ?? '')) checks.push(`${role} has no accessible name`);
    if (element instanceof HTMLImageElement && !element.hasAttribute('alt')) checks.push('Image has no alt attribute');
    if (element instanceof HTMLInputElement && !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) checks.push('Input has no associated label');
    const scrollAncestors = collectScrollAncestors(element);
    const stackingContexts = collectStackingContexts(element);
    const parent = element.parentElement;
    const parentStyle = parent ? getComputedStyle(parent) : undefined;
    const containingBlock = findContainingBlock(element, style.position);
    const hiddenBy = hiddenAncestors(element);
    const fixedContainingBlock = style.position === 'fixed' ? findTransformedAncestor(element) : undefined;
    const overlayCoverage = coverage && coverage.ratio >= 0.25 ? coverage : undefined;
    const stackingContextConflict = overlayCoverage ? stackingConflict(element, overlayCoverage.element) : undefined;
    const parentRect = parent?.getBoundingClientRect();
    const facts = {
      selector: selectorFor(element), display: style.display, position: style.position, visibility: style.visibility, opacity: Number(style.opacity),
      width: rect.width, height: rect.height, viewportWidth: width, viewportHeight: height, documentWidth: document.documentElement.scrollWidth,
      parentSelector: parent ? selectorFor(parent) : undefined, parentDisplay: parentStyle?.display, parentWidth: parentRect?.width,
      contentOverflows: element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1,
      parentOverflowX: parentStyle?.overflowX, parentOverflowY: parentStyle?.overflowY, inViewport, clippingSelector: clipping ? selectorFor(clipping) : undefined,
      hiddenBy: hiddenBy.map(selectorFor), coveringSelector: overlayCoverage ? selectorFor(overlayCoverage.element) : undefined,
      coveredSamples: overlayCoverage?.coveredSamples ?? 0, testedSamples: overlayCoverage?.testedSamples ?? 0,
      pointerEvents: style.pointerEvents, disabled, ariaDisabled, interactive, keyboardReachable, accessibleName: Boolean(accessibleName),
      minWidth: style.minWidth, maxWidth: style.maxWidth, stickyTop: style.top, stickyBottom: style.bottom, fixedContainingBlock: fixedContainingBlock ? selectorFor(fixedContainingBlock) : undefined,
      stackingContextConflict, scrollAncestorSelectors: scrollAncestors.map((item) => item.selector), flexShrink: style.flexShrink,
      minWidthAuto: style.minWidth === 'auto', gridColumns: parentStyle?.gridTemplateColumns,
    };
    const diagnostics = evaluateLayoutDiagnostics(facts);
    if (checks.length) diagnostics.push({ severity: 'warning', title: 'Accessibility check', evidence: checks.join('; ') });
    if (element.getAttribute('aria-hidden') === 'true' || hiddenBy.length) {
      if (element.getAttribute('aria-hidden') === 'true') diagnostics.push({ severity: 'warning', title: 'Element is hidden from assistive technology', evidence: 'aria-hidden="true"' });
    }
    const interaction = classifyInteraction({ hidden: style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0 || hiddenBy.length > 0 || !inViewport, disabled: Boolean(disabled || ariaDisabled), pointerEvents: style.pointerEvents, coveredSamples: overlayCoverage?.coveredSamples ?? 0, testedSamples: overlayCoverage?.testedSamples ?? 0 });
    if (interaction.reasons.length) diagnostics.push({ severity: interaction.state === 'blocked' ? 'warning' : 'info', title: interaction.state === 'blocked' ? 'Interaction is blocked' : 'Interaction may be blocked', evidence: interaction.reasons.join('; ') });
    const roleValue = element.getAttribute('role');
    return {
      kind: 'ui-snapshot', id: crypto.randomUUID(), timestamp: Date.now(), selector: selectorFor(element), simpleSelector: simpleSelector(element), domPath: domPath(element),
      tagName: element.tagName.toLowerCase(), nodeName: element.nodeName, idAttribute: element.id || undefined, classList: Array.from(element.classList).slice(0, 20),
      text: (element instanceof HTMLInputElement && sensitiveValue ? '[REDACTED]' : (element instanceof HTMLElement ? element.innerText : element.textContent ?? '')).trim().slice(0, 2000), html: safeOuterHTML(element).slice(0, 8000), attributes: attrs,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      styles: { computed, box: { margin: style.margin, border: style.border, padding: style.padding, content: `${Math.max(0, rect.width - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth))} × ${Math.max(0, rect.height - px(style.paddingTop) - px(style.paddingBottom) - px(style.borderTopWidth) - px(style.borderBottomWidth))}`, sides: { margin: sideValues(style, 'margin'), border: sideValues(style, 'border'), padding: sideValues(style, 'padding') } }, variables },
      ancestry, accessibility: { role: roleValue ?? implicitRole(element), name: accessibleName, label: element.getAttribute('aria-label') ?? undefined, labelledBy: element.getAttribute('aria-labelledby') ?? undefined, describedBy: element.getAttribute('aria-describedby') ?? undefined, tabindex: element.getAttribute('tabindex') ?? undefined, disabled: Boolean(disabled), checks },
      visibility: { display: style.display, visibility: style.visibility, opacity: Number(style.opacity), inViewport, clipped: Boolean(clipping), covered: Boolean(overlayCoverage && overlayCoverage.ratio >= 0.8), coveringSelector: overlayCoverage ? selectorFor(overlayCoverage.element) : undefined, hiddenBy: hiddenBy.map(selectorFor), clippingSelector: clipping ? selectorFor(clipping) : undefined, coverage: overlayCoverage ? { samplesCovered: overlayCoverage.coveredSamples, samplesTested: overlayCoverage.testedSamples, certainty: overlayCoverage.ratio >= 0.8 ? 'likely' : 'possible' } : undefined },
      viewport: { width, height, scrollX: window.scrollX, scrollY: window.scrollY, devicePixelRatio: window.devicePixelRatio || 1 },
      layout: { position: style.position, display: style.display, containingBlock: containingBlock ? selectorFor(containingBlock) : undefined, parentDisplay: parentStyle?.display, overflowX: style.overflowX, overflowY: style.overflowY, flex: parentStyle && ['flex', 'inline-flex'].includes(parentStyle.display) ? { direction: parentStyle.flexDirection, wrap: parentStyle.flexWrap, justifyContent: parentStyle.justifyContent, alignItems: parentStyle.alignItems, gap: parentStyle.gap, grow: style.flexGrow, shrink: style.flexShrink, basis: style.flexBasis, order: style.order, alignSelf: style.alignSelf } : undefined, grid: parentStyle && ['grid', 'inline-grid'].includes(parentStyle.display) ? { columns: parentStyle.gridTemplateColumns, rows: parentStyle.gridTemplateRows, gap: parentStyle.gap, autoFlow: parentStyle.gridAutoFlow, column: style.gridColumn, row: style.gridRow } : undefined, scrollAncestors, stackingContexts },
      interaction: { ...interaction, pointerEvents: style.pointerEvents, disabled: Boolean(disabled || ariaDisabled), keyboardReachable },
      diagnostics, page: { url: location.href.slice(0, 4096), viewportWidth: width, viewportHeight: height },
    };
  }
  function clippingAncestor(element: Element, rect: DOMRect): Element | undefined {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent); const box = parent.getBoundingClientRect();
      const clipsX = /(hidden|clip|auto|scroll)/.test(css.overflowX) && (rect.left < box.left || rect.right > box.right);
      const clipsY = /(hidden|clip|auto|scroll)/.test(css.overflowY) && (rect.top < box.top || rect.bottom > box.bottom);
      if (clipsX || clipsY) return parent;
    }
    return undefined;
  }
  function coverAtPoints(element: Element, rect: DOMRect): { element: Element; coveredSamples: number; testedSamples: number; ratio: number } | undefined {
    if (!rect.width || !rect.height) return undefined;
    const points = [[.5,.5],[.1,.1],[.5,.1],[.9,.1],[.1,.5],[.9,.5],[.1,.9],[.5,.9],[.9,.9]];
    const candidateCounts = new Map<Element, number>(); let testedSamples = 0; let coveredSamples = 0;
    for (const [x, y] of points) {
      const px = rect.left + rect.width * x!; const py = rect.top + rect.height * y!;
      if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) continue;
      testedSamples += 1;
      const top = deepElementFromPoint(px, py);
      if (!top || top === element || element.contains(top) || top === overlay || top.closest('[data-debug-lens-internal]')) continue;
      coveredSamples += 1; candidateCounts.set(top, (candidateCounts.get(top) ?? 0) + 1);
    }
    const winner = [...candidateCounts.entries()].sort((left, right) => right[1] - left[1])[0];
    if (!winner || testedSamples === 0) return undefined;
    return { element: winner[0], coveredSamples, testedSamples, ratio: coveredSamples / testedSamples };
  }
  function deepElementFromPoint(x: number, y: number): Element | null {
    let current = document.elementFromPoint(x, y);
    for (let depth = 0; current && depth < 8; depth += 1) {
      const shadow = current.shadowRoot;
      const nested = shadow?.elementFromPoint(x, y);
      if (!nested || nested === current) break;
      current = nested;
    }
    return current;
  }
  function collectScrollAncestors(element: Element): NonNullable<UIElementRecord['layout']>['scrollAncestors'] {
    const result: NonNullable<UIElementRecord['layout']>['scrollAncestors'] = [];
    for (let parent = element.parentElement; parent && result.length < 12; parent = parent.parentElement) {
      const css = getComputedStyle(parent);
      const scrollableX = /(auto|scroll|overlay)/.test(css.overflowX) && parent.scrollWidth > parent.clientWidth + 1;
      const scrollableY = /(auto|scroll|overlay)/.test(css.overflowY) && parent.scrollHeight > parent.clientHeight + 1;
      if (!scrollableX && !scrollableY) continue;
      result.push({ selector: selectorFor(parent), overflowX: css.overflowX, overflowY: css.overflowY, scrollWidth: parent.scrollWidth, clientWidth: parent.clientWidth, scrollHeight: parent.scrollHeight, clientHeight: parent.clientHeight, scrollTop: parent.scrollTop, scrollLeft: parent.scrollLeft });
    }
    return result;
  }
  function collectStackingContexts(element: Element): NonNullable<UIElementRecord['layout']>['stackingContexts'] {
    const chain: Element[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) chain.unshift(node);
    return chain.filter((node) => stackingContextReasons(node).length > 0).slice(-12).map((node) => ({ selector: selectorFor(node), zIndex: getComputedStyle(node).zIndex, reasons: stackingContextReasons(node) }));
  }
  function stackingContextReasons(element: Element): string[] {
    const style = getComputedStyle(element); const reasons: string[] = [];
    if (element === document.documentElement) reasons.push('root');
    if (['fixed', 'sticky'].includes(style.position)) reasons.push(`position:${style.position}`);
    if (style.position !== 'static' && style.zIndex !== 'auto') reasons.push(`position + z-index:${style.zIndex}`);
    if (Number(style.opacity) < 1) reasons.push(`opacity:${style.opacity}`);
    if (style.transform !== 'none') reasons.push('transform');
    if (style.filter !== 'none') reasons.push('filter');
    if (style.perspective !== 'none') reasons.push('perspective');
    if (style.isolation === 'isolate') reasons.push('isolation:isolate');
    if (style.mixBlendMode !== 'normal') reasons.push(`mix-blend-mode:${style.mixBlendMode}`);
    if (/(transform|opacity|filter|perspective)/.test(style.willChange)) reasons.push(`will-change:${style.willChange}`);
    if (/(paint|layout|strict|content)/.test(style.contain)) reasons.push(`contain:${style.contain}`);
    return reasons;
  }
  function stackingConflict(element: Element, covering: Element): string | undefined {
    const selectedChain = collectStackingContexts(element); const coveringChain = collectStackingContexts(covering);
    let common = 0;
    while (common < selectedChain.length && common < coveringChain.length && selectedChain[common]!.selector === coveringChain[common]!.selector) common += 1;
    const selectedContext = selectedChain[common]; const coveringContext = coveringChain[common];
    if (!selectedContext || !coveringContext || selectedContext.selector === coveringContext.selector) return undefined;
    return `${selectedContext.selector} (z-index ${selectedContext.zIndex}) and ${coveringContext.selector} (z-index ${coveringContext.zIndex}) are separate stacking contexts; a child z-index cannot escape its ancestor context`;
  }
  function findContainingBlock(element: Element, position: string): Element | undefined {
    if (position !== 'absolute' && position !== 'fixed') return undefined;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (position === 'absolute' && style.position !== 'static') return parent;
      if (style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || style.contain !== 'none') return parent;
      if (position === 'fixed' && style.willChange.includes('transform')) return parent;
    }
    return position === 'fixed' ? document.documentElement : undefined;
  }
  function findTransformedAncestor(element: Element): Element | undefined {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' || style.contain.includes('paint')) return parent;
    }
    return undefined;
  }
  function hiddenAncestors(element: Element): Element[] {
    const result: Element[] = [];
    for (let node: Element | null = element; node && result.length < 12; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hasAttribute('hidden') || style.display === 'none' || style.visibility === 'hidden' || style.contentVisibility === 'hidden' || Number(style.opacity) === 0) result.push(node);
    }
    return result;
  }
  function sideValues(style: CSSStyleDeclaration, prefix: 'margin' | 'border' | 'padding'): Record<'top' | 'right' | 'bottom' | 'left', string> {
    return { top: style.getPropertyValue(`${prefix}-top${prefix === 'border' ? '-width' : ''}`), right: style.getPropertyValue(`${prefix}-right${prefix === 'border' ? '-width' : ''}`), bottom: style.getPropertyValue(`${prefix}-bottom${prefix === 'border' ? '-width' : ''}`), left: style.getPropertyValue(`${prefix}-left${prefix === 'border' ? '-width' : ''}`) };
  }
  function safeOuterHTML(element: Element): string {
    // Bound work before serializing: outerHTML.slice() still serializes an unbounded subtree.
    let remaining = 8000; let visited = 0;
    const escapeText = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const escapeAttribute = (value: string) => escapeText(value).replaceAll('"', '&quot;');
    const visit = (node: Node, depth: number): string => {
      if (remaining <= 0 || visited++ >= 160 || depth > 8) return '<!-- snapshot truncated -->';
      if (node.nodeType === Node.TEXT_NODE) {
        const text = (node.textContent ?? '').slice(0, remaining);
        remaining -= text.length;
        return escapeText(text);
      }
      if (!(node instanceof Element) || node.closest('[data-debug-lens-internal]')) return '';
      const tagName = node.tagName.toLowerCase();
      const sensitive = node.matches('input[type="password"], input[name*="token" i], input[id*="token" i], input[name*="secret" i], input[id*="secret" i], input[name*="password" i], input[id*="password" i], input[name*="api-key" i], input[id*="api-key" i]');
      const attributes = Array.from(node.attributes).slice(0, 40).map((attribute) => {
        const value = sensitive && attribute.name.toLowerCase() === 'value' ? '[REDACTED]' : attribute.value.slice(0, 300);
        return ` ${attribute.name}="${escapeAttribute(value)}"`;
      }).join('');
      const opening = `<${tagName}${attributes}>`;
      remaining -= opening.length;
      if (['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'].includes(tagName)) return opening;
      let contents = '';
      const children = Array.from(node.childNodes);
      for (const child of children.slice(0, 80)) {
        if (remaining <= 0 || visited >= 160) { contents += '<!-- snapshot truncated -->'; break; }
        contents += visit(child, depth + 1);
      }
      if (children.length > 80) contents += '<!-- children omitted -->';
      const closing = `</${tagName}>`; remaining -= closing.length;
      return `${opening}${contents}${closing}`;
    };
    return visit(element, 0).slice(0, 8000);
  }
  function beginObservation(element: Element) {
    for (const type of trackedEvents) document.addEventListener(type, onRelatedEvent, true);
    window.addEventListener('scroll', onViewportChange, true); window.addEventListener('resize', onViewportChange);
    observer?.disconnect(); mutationCount = 0;
    observer = new MutationObserver((mutations) => {
      let captured = false;
      for (const mutation of mutations) {
        if (mutation.target instanceof Element && mutation.target.closest('[data-debug-lens-internal]')) continue;
        if (++mutationCount > 300) { observer?.disconnect(); showToast('Mutation capture limit reached'); break; }
        captured = true;
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        const base = { kind: 'mutation' as const, id: crypto.randomUUID(), timestamp: Date.now(), targetSelector: target ? selectorFor(target) : selectorFor(element) };
        if (mutation.type === 'attributes') sendRecord({ ...base, change: 'attribute', name: mutation.attributeName ?? undefined, before: (mutation.oldValue ?? '').slice(0, 1000), after: (target?.getAttribute(mutation.attributeName ?? '') ?? '').slice(0, 1000) });
        else if (mutation.type === 'characterData') sendRecord({ ...base, change: 'text', before: (mutation.oldValue ?? '').slice(0, 1000), after: (mutation.target.textContent ?? '').slice(0, 1000) });
        else sendRecord({ ...base, change: 'child', name: 'children', before: `${mutation.removedNodes.length} removed`, after: `${mutation.addedNodes.length} added` });
      }
      if (selected?.isConnected) { drawOutline(selected); if (captured) sendRecord(snapshot(selected)); }
    });
    observer.observe(element, { attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true, childList: true, subtree: true });
  }
  function onRelatedEvent(event: Event) {
    const target = event.target; if (!(target instanceof Element) || !selected || !(target === selected || selected.contains(target) || event.type === 'submit' && target === selected.closest('form'))) return;
    sendRecord(eventRecord(event.type, target, event instanceof KeyboardEvent ? event.key : undefined));
  }
  const trackedEvents = ['click','pointerdown','pointerup','input','change','submit','keydown','keyup','focus','blur'] as const;
  function eventRecord(type: string, target: Element, key?: string) { return { kind: 'event' as const, id: crypto.randomUUID(), timestamp: Date.now(), type, targetSelector: selectorFor(target), ...(key ? { key: key.slice(0, 40) } : {}) }; }
  function sendRecord(payload: object) { try { void chrome.runtime.sendMessage({ type: 'debug:record', payload }).catch(() => undefined); } catch { /* Inspection must not affect the page. */ } }
  function selectorFor(element: Element): string {
    for (const attribute of ['data-testid', 'data-test', 'data-cy']) { const value = element.getAttribute(attribute); if (value) return `[${attribute}="${value.replaceAll('"','\\"')}"]`; }
    if (element.id) return `#${escapeCss(element.id)}`;
    return simpleSelector(element);
  }
  function simpleSelector(element: Element): string { return `${element.tagName.toLowerCase()}${element.id ? `#${escapeCss(element.id)}` : ''}${Array.from(element.classList).slice(0, 3).map((name) => `.${escapeCss(name)}`).join('')}`; }
  function domPath(element: Element): string { const parts: string[] = []; for (let node: Element | null = element; node && parts.length < 6 && node !== document.documentElement; node = node.parentElement) { if (node.id) { parts.unshift(`#${escapeCss(node.id)}`); break; } const same = node.parentElement ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName) : []; parts.unshift(`${node.tagName.toLowerCase()}${same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''}`); } return parts.join(' > '); }
  function escapeCss(value: string) { try { return CSS.escape(value); } catch { return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'); } }
  function implicitRole(element: Element): string | undefined { const tagName = element.tagName.toLowerCase(); if (tagName === 'button') return 'button'; if (tagName === 'a' && element.hasAttribute('href')) return 'link'; if (tagName === 'img') return 'img'; if (tagName === 'textarea' || element instanceof HTMLInputElement) return 'textbox'; if (tagName === 'form') return 'form'; return undefined; }
  function nameOf(element: Element): string | undefined { const aria = element.getAttribute('aria-label'); if (aria) return aria.trim().slice(0, 500); const labelledBy = element.getAttribute('aria-labelledby'); if (labelledBy) { const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (text) return text.slice(0, 500); } if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) { const label = element.labels?.[0]?.textContent?.trim(); if (label) return label.slice(0, 500); } const text = (element instanceof HTMLElement ? element.innerText : element.textContent ?? '').trim(); if (text) return text.slice(0, 500); if (element instanceof HTMLImageElement && element.alt) return element.alt.slice(0, 500); return undefined; }
  function px(value: string) { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : 0; }
  function showToast(text: string) { if (!document.documentElement) return; const toast = document.createElement('div'); toast.dataset.debugLensInternal = 'toast'; toast.textContent = text; Object.assign(toast.style, { position: 'fixed', zIndex: '2147483647', right: '16px', bottom: '16px', padding: '8px 11px', borderRadius: '5px', background: '#111827', color: '#fff', boxShadow: '0 3px 12px #0005', font: '12px ui-sans-serif,system-ui', pointerEvents: 'none', maxWidth: 'min(520px,90vw)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); document.documentElement.append(toast); setTimeout(() => toast.remove(), 2200); }
}
