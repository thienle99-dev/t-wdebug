import type { UIElementRecord } from '../shared/types';

declare global { interface Window { __DEBUG_LENS_UI_INSPECTOR__?: boolean } }
if (!window.__DEBUG_LENS_UI_INSPECTOR__) {
  window.__DEBUG_LENS_UI_INSPECTOR__ = true;
  const overlay = document.createElement('div');
  const tag = document.createElement('div');
  Object.assign(overlay.style, { position: 'fixed', display: 'none', zIndex: '2147483647', pointerEvents: 'none', border: '2px solid #4388ff', background: 'rgba(67,136,255,.12)', boxSizing: 'border-box' });
  Object.assign(tag.style, { position: 'absolute', left: '-2px', top: '-24px', padding: '3px 6px', color: '#fff', background: '#2563eb', borderRadius: '3px', font: '11px/1.3 ui-monospace,monospace', whiteSpace: 'nowrap', maxWidth: 'min(420px,90vw)', overflow: 'hidden', textOverflow: 'ellipsis' });
  overlay.append(tag);
  let selected: Element | undefined;
  let observer: MutationObserver | undefined;
  let mutationCount = 0;
  let scheduled = false;

  chrome.runtime.onMessage.addListener((message: { type?: string; enabled?: boolean }) => {
    if (message?.type !== 'debug:ui:picker') return;
    if (message.enabled) startPicking(); else stopInspection();
  });

  function startPicking() {
    stopInspection();
    if (!overlay.isConnected) (document.documentElement ?? document).append(overlay);
    selected = undefined;
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
  }
  function stopInspection() {
    stopPicking(); observer?.disconnect(); observer = undefined; selected = undefined;
    document.removeEventListener('click', onRelatedEvent, true); document.removeEventListener('input', onRelatedEvent, true); document.removeEventListener('change', onRelatedEvent, true); document.removeEventListener('submit', onRelatedEvent, true); document.removeEventListener('keydown', onRelatedEvent, true); document.removeEventListener('pointerdown', onRelatedEvent, true);
    overlay.style.display = 'none';
  }
  function onPickerKey(event: KeyboardEvent) { if (event.key === 'Escape') { stopPicking(); event.stopImmediatePropagation(); } }
  function onPointerMove(event: PointerEvent) {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; const element = document.elementFromPoint(event.clientX, event.clientY); if (element && !overlay.contains(element)) drawOutline(element); });
  }
  function onPickClick(event: MouseEvent) {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!element || overlay.contains(element)) return;
    event.preventDefault(); event.stopPropagation(); event.stopImmediatePropagation();
    selected = element; stopPicking();
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
  window.addEventListener('scroll', onViewportChange, true); window.addEventListener('resize', onViewportChange);

  function snapshot(element: Element): Omit<UIElementRecord, 'tabId'> {
    const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
    const width = document.documentElement.clientWidth; const height = document.documentElement.clientHeight;
    const attrs: Record<string, string> = {};
    for (const attribute of Array.from(element.attributes).slice(0, 80)) attrs[attribute.name] = attribute.value.slice(0, 1000);
    const computed: Record<string, string> = {};
    for (const property of ['display','position','width','height','min-width','max-width','min-height','max-height','margin','margin-top','margin-right','margin-bottom','margin-left','padding','border','overflow','overflow-x','overflow-y','z-index','opacity','visibility','pointer-events','font-size','line-height','color','background-color','background','flex','flex-shrink','grid','transform']) computed[property] = style.getPropertyValue(property);
    const ancestry: UIElementRecord['ancestry'] = [];
    for (let node = element.parentElement; node && ancestry.length < 6; node = node.parentElement) ancestry.push({ selector: simpleSelector(node), tagName: node.tagName.toLowerCase(), id: node.id || undefined, classes: Array.from(node.classList).slice(0, 8) });
    const variables: Record<string, string> = {};
    for (let node: Element | null = element; node && Object.keys(variables).length < 40; node = node.parentElement) {
      const nodeStyle = getComputedStyle(node);
      for (let index = 0; index < nodeStyle.length && Object.keys(variables).length < 40; index++) { const name = nodeStyle.item(index); if (name.startsWith('--') && variables[name] === undefined) variables[name] = nodeStyle.getPropertyValue(name).trim().slice(0, 300); }
    }
    const inViewport = rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
    const clipping = clippingAncestor(element, rect);
    const covering = coverAtPoints(element, rect);
    const disabled = (element instanceof HTMLButtonElement || element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) && element.disabled;
    const role = element.getAttribute('role') ?? implicitRole(element);
    const accessibleName = nameOf(element);
    const checks: string[] = [];
    if (!accessibleName && ['button','link','textbox','img'].includes(role ?? '')) checks.push(`${role} has no accessible name`);
    if (element instanceof HTMLImageElement && !element.hasAttribute('alt')) checks.push('Image has no alt attribute');
    if (element instanceof HTMLInputElement && !element.labels?.length && !element.getAttribute('aria-label') && !element.getAttribute('aria-labelledby')) checks.push('Input has no associated label');
    const diagnostics: UIElementRecord['diagnostics'] = [];
    if (style.display === 'none') diagnostics.push({ severity: 'warning', title: 'Element is not displayed', evidence: 'display: none' });
    if (style.visibility === 'hidden' || Number(style.opacity) === 0) diagnostics.push({ severity: 'warning', title: 'Element is visually hidden', evidence: `visibility: ${style.visibility}; opacity: ${style.opacity}` });
    if (rect.width === 0 || rect.height === 0) diagnostics.push({ severity: 'warning', title: 'Element has zero size', evidence: `${rect.width} × ${rect.height} CSS pixels` });
    if (!inViewport) diagnostics.push({ severity: 'warning', title: 'Outside current viewport', evidence: `Bounds ${Math.round(rect.left)}, ${Math.round(rect.top)} · viewport ${width} × ${height}` });
    if (clipping) diagnostics.push({ severity: 'warning', title: 'Clipped by an ancestor', evidence: `${simpleSelector(clipping)} has overflow clipping` });
    if (covering) diagnostics.push({ severity: 'warning', title: 'Possibly covered by another element', evidence: `Top element at sampled point: ${simpleSelector(covering)}` });
    if (style.pointerEvents === 'none') diagnostics.push({ severity: 'warning', title: 'Pointer events are disabled', evidence: 'pointer-events: none' });
    if (disabled || element.getAttribute('aria-disabled') === 'true') diagnostics.push({ severity: 'info', title: 'Element is disabled', evidence: disabled ? 'Native disabled state is set' : 'aria-disabled="true"' });
    if (rect.width > width) diagnostics.push({ severity: 'warning', title: 'Element is wider than the viewport', evidence: `${Math.round(rect.width)}px element · ${width}px viewport` });
    if (Number.parseInt(style.zIndex, 10) > 999) diagnostics.push({ severity: 'info', title: 'High stacking order', evidence: `z-index: ${style.zIndex}` });
    if (checks.length) diagnostics.push({ severity: 'warning', title: 'Accessibility check', evidence: checks.join('; ') });
    if (document.documentElement.scrollWidth > width) diagnostics.push({ severity: 'info', title: 'Page has horizontal overflow', evidence: `Document ${document.documentElement.scrollWidth}px · viewport ${width}px` });
    const roleValue = element.getAttribute('role');
    return {
      kind: 'ui-snapshot', id: crypto.randomUUID(), timestamp: Date.now(), selector: selectorFor(element), simpleSelector: simpleSelector(element), domPath: domPath(element),
      tagName: element.tagName.toLowerCase(), idAttribute: element.id || undefined, classList: Array.from(element.classList).slice(0, 20),
      text: (element instanceof HTMLElement ? element.innerText : element.textContent ?? '').trim().slice(0, 2000), html: element.outerHTML.slice(0, 8000), attributes: attrs,
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height, top: rect.top, right: rect.right, bottom: rect.bottom, left: rect.left },
      styles: { computed, box: { margin: style.margin, border: style.border, padding: style.padding, content: `${Math.max(0, rect.width - px(style.paddingLeft) - px(style.paddingRight) - px(style.borderLeftWidth) - px(style.borderRightWidth))} × ${Math.max(0, rect.height - px(style.paddingTop) - px(style.paddingBottom) - px(style.borderTopWidth) - px(style.borderBottomWidth))}` }, variables },
      ancestry, accessibility: { role: roleValue ?? implicitRole(element), name: accessibleName, label: element.getAttribute('aria-label') ?? undefined, labelledBy: element.getAttribute('aria-labelledby') ?? undefined, describedBy: element.getAttribute('aria-describedby') ?? undefined, tabindex: element.getAttribute('tabindex') ?? undefined, disabled: Boolean(disabled), checks },
      visibility: { display: style.display, visibility: style.visibility, opacity: Number(style.opacity), inViewport, clipped: Boolean(clipping), covered: Boolean(covering), coveringSelector: covering ? selectorFor(covering) : undefined },
      diagnostics, page: { url: location.href.slice(0, 4096), viewportWidth: width, viewportHeight: height },
    };
  }
  function clippingAncestor(element: Element, rect: DOMRect): Element | undefined {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const css = getComputedStyle(parent); if (!/(hidden|clip|auto|scroll)/.test(`${css.overflowX} ${css.overflowY}`)) continue;
      const box = parent.getBoundingClientRect(); if (rect.left < box.left || rect.right > box.right || rect.top < box.top || rect.bottom > box.bottom) return parent;
    }
    return undefined;
  }
  function coverAtPoints(element: Element, rect: DOMRect): Element | undefined {
    if (!rect.width || !rect.height) return undefined;
    const points = [[.5,.5],[.15,.15],[.85,.15],[.15,.85],[.85,.85]];
    for (const [x, y] of points) {
      const px = rect.left + rect.width * x!; const py = rect.top + rect.height * y!;
      if (px < 0 || py < 0 || px >= innerWidth || py >= innerHeight) continue;
      const top = document.elementsFromPoint(px, py).find((candidate) => candidate !== overlay && !overlay.contains(candidate));
      if (top && top !== element && !element.contains(top)) return top;
    }
    return undefined;
  }
  function beginObservation(element: Element) {
    document.addEventListener('click', onRelatedEvent, true); document.addEventListener('input', onRelatedEvent, true); document.addEventListener('change', onRelatedEvent, true); document.addEventListener('submit', onRelatedEvent, true); document.addEventListener('keydown', onRelatedEvent, true); document.addEventListener('pointerdown', onRelatedEvent, true);
    observer?.disconnect(); mutationCount = 0;
    observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (++mutationCount > 300) { observer?.disconnect(); showToast('Mutation capture limit reached'); break; }
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        const base = { kind: 'mutation' as const, id: crypto.randomUUID(), timestamp: Date.now(), targetSelector: target ? selectorFor(target) : selectorFor(element) };
        if (mutation.type === 'attributes') sendRecord({ ...base, change: 'attribute', name: mutation.attributeName ?? undefined, before: (mutation.oldValue ?? '').slice(0, 1000), after: (target?.getAttribute(mutation.attributeName ?? '') ?? '').slice(0, 1000) });
        else if (mutation.type === 'characterData') sendRecord({ ...base, change: 'text', before: (mutation.oldValue ?? '').slice(0, 1000), after: (mutation.target.textContent ?? '').slice(0, 1000) });
        else sendRecord({ ...base, change: 'child', name: 'children', before: `${mutation.removedNodes.length} removed`, after: `${mutation.addedNodes.length} added` });
      }
      if (selected?.isConnected) drawOutline(selected);
    });
    observer.observe(element, { attributes: true, attributeOldValue: true, characterData: true, characterDataOldValue: true, childList: true, subtree: true });
  }
  function onRelatedEvent(event: Event) {
    const target = event.target; if (!(target instanceof Element) || !selected || !(target === selected || selected.contains(target) || event.type === 'submit' && target === selected.closest('form'))) return;
    sendRecord(eventRecord(event.type, target, event instanceof KeyboardEvent ? event.key : undefined));
  }
  function eventRecord(type: string, target: Element, key?: string) { return { kind: 'event' as const, id: crypto.randomUUID(), timestamp: Date.now(), type, targetSelector: selectorFor(target), ...(key ? { key: key.slice(0, 40) } : {}) }; }
  function sendRecord(payload: object) { try { void chrome.runtime.sendMessage({ type: 'debug:record', payload }).catch(() => undefined); } catch { /* Inspection must not affect the page. */ } }
  function selectorFor(element: Element): string { if (element.id) return `#${escapeCss(element.id)}`; const testId = element.getAttribute('data-testid'); if (testId) return `[data-testid="${testId.replaceAll('"','\\"')}"]`; return simpleSelector(element); }
  function simpleSelector(element: Element): string { return `${element.tagName.toLowerCase()}${element.id ? `#${escapeCss(element.id)}` : ''}${Array.from(element.classList).slice(0, 3).map((name) => `.${escapeCss(name)}`).join('')}`; }
  function domPath(element: Element): string { const parts: string[] = []; for (let node: Element | null = element; node && parts.length < 6 && node !== document.documentElement; node = node.parentElement) { if (node.id) { parts.unshift(`#${escapeCss(node.id)}`); break; } const same = node.parentElement ? Array.from(node.parentElement.children).filter((item) => item.tagName === node!.tagName) : []; parts.unshift(`${node.tagName.toLowerCase()}${same.length > 1 ? `:nth-of-type(${same.indexOf(node) + 1})` : ''}`); } return parts.join(' > '); }
  function escapeCss(value: string) { try { return CSS.escape(value); } catch { return value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'); } }
  function implicitRole(element: Element): string | undefined { const tagName = element.tagName.toLowerCase(); if (tagName === 'button') return 'button'; if (tagName === 'a' && element.hasAttribute('href')) return 'link'; if (tagName === 'img') return 'img'; if (tagName === 'textarea' || element instanceof HTMLInputElement) return 'textbox'; if (tagName === 'form') return 'form'; return undefined; }
  function nameOf(element: Element): string | undefined { const aria = element.getAttribute('aria-label'); if (aria) return aria.trim().slice(0, 500); const labelledBy = element.getAttribute('aria-labelledby'); if (labelledBy) { const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim(); if (text) return text.slice(0, 500); } if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement) { const label = element.labels?.[0]?.textContent?.trim(); if (label) return label.slice(0, 500); } const text = (element instanceof HTMLElement ? element.innerText : element.textContent ?? '').trim(); if (text) return text.slice(0, 500); if (element instanceof HTMLImageElement && element.alt) return element.alt.slice(0, 500); return undefined; }
  function px(value: string) { const number = Number.parseFloat(value); return Number.isFinite(number) ? number : 0; }
  function showToast(text: string) { const toast = document.createElement('div'); toast.textContent = text; Object.assign(toast.style, { position: 'fixed', zIndex: '2147483647', right: '16px', bottom: '16px', padding: '8px 11px', borderRadius: '5px', background: '#111827', color: '#fff', boxShadow: '0 3px 12px #0005', font: '12px ui-sans-serif,system-ui', pointerEvents: 'none', maxWidth: 'min(520px,90vw)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }); (document.documentElement ?? document).append(toast); setTimeout(() => toast.remove(), 2200); }
}
