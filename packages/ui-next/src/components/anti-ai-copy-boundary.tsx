import { useCallback, useMemo, useRef, useState, type ClipboardEvent, type ReactNode } from 'react';
import type { AntiAiMarkerClientMarker } from '@/lib/anti-ai-marker';

interface SourcePoint {
  offset?: number;
}

interface SourcePosition {
  start?: SourcePoint;
  end?: SourcePoint;
}

interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
  position?: SourcePosition;
}

export class AntiAiMarkerRenderError extends Error {
  override name = 'AntiAiMarkerRenderError';
}

function bounds(node: HastNode): { start: number; end: number } | null {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && Number(end) >= Number(start) ? { start: Number(start), end: Number(end) } : null;
}

function markerNode(id: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: {
      'aria-hidden': 'true',
      className: ['anti-ai-copy-marker'],
      'data-anti-ai-marker-id': id,
    },
    children: [],
  };
}

const ATOMIC_START_ATTRIBUTE = 'data-anti-ai-atomic-start';
const ATOMIC_END_ATTRIBUTE = 'data-anti-ai-atomic-end';
const ATOMIC_FULL_ATTRIBUTE = 'data-anti-ai-atomic-full';
const ATOMIC_SOURCE_ATTRIBUTE = 'data-anti-ai-atomic-source';
const ATOMIC_INDEXES_ATTRIBUTE = 'data-anti-ai-atomic-indexes';

type AtomicMarkerSide = 'start' | 'end' | 'full';

function atomicAttribute(side: AtomicMarkerSide): string {
  if (side === 'start') return ATOMIC_START_ATTRIBUTE;
  if (side === 'end') return ATOMIC_END_ATTRIBUTE;
  return ATOMIC_FULL_ATTRIBUTE;
}

function decorateAtomicMarker(node: HastNode, id: string, side: AtomicMarkerSide) {
  if (node.type !== 'element') return;
  node.properties ||= {};
  const attribute = atomicAttribute(side);
  const current = node.properties[attribute];
  const ids = typeof current === 'string' ? current.split(' ').filter(Boolean) : [];
  if (!ids.includes(id)) node.properties[attribute] = [...ids, id].join(' ');
}

function isMathNode(node: HastNode): boolean {
  const className = node.properties?.className;
  const classes = Array.isArray(className) ? className : typeof className === 'string' ? className.split(' ') : [];
  return classes.includes('math-inline') || classes.includes('math-display');
}

function decorateAtomicFullMarker(node: HastNode, id: string, source: string, index: number) {
  decorateAtomicMarker(node, id, 'full');
  node.properties ||= {};
  const currentSource = node.properties[ATOMIC_SOURCE_ATTRIBUTE];
  if (currentSource !== undefined && currentSource !== source) throw new AntiAiMarkerRenderError('Formula marker source is inconsistent');
  node.properties[ATOMIC_SOURCE_ATTRIBUTE] = source;
  const rawIndexes = node.properties[ATOMIC_INDEXES_ATTRIBUTE];
  const indexes = typeof rawIndexes === 'string' ? (JSON.parse(rawIndexes) as unknown[]) : [];
  indexes.push({ id, index });
  node.properties[ATOMIC_INDEXES_ATTRIBUTE] = JSON.stringify(indexes);
}

function formulaTextIndex(source: string, node: HastNode, offset: number): { source: string; index: number } {
  const position = bounds(node);
  if (!position) throw new AntiAiMarkerRenderError('LaTeX source position is unavailable for anti AI markers');
  const formula = textValue(node);
  const raw = source.slice(position.start, position.end);
  const formulaStart = raw.indexOf(formula);
  const index = offset - position.start - formulaStart;
  if (formulaStart < 0 || index < 0 || index > formula.length) {
    throw new AntiAiMarkerRenderError('LaTeX marker cannot be mapped to the formula source');
  }
  return { source: formula, index };
}

function wrapMathMarkers(source: string, node: HastNode, markers: readonly AntiAiMarkerClientMarker[], handled: Set<string>) {
  if (!node.children) return;
  for (let index = 0; index < node.children.length; index++) {
    const child = node.children[index];
    if (!isMathNode(child)) {
      wrapMathMarkers(source, child, markers, handled);
      continue;
    }
    const position = bounds(child);
    if (!position) throw new AntiAiMarkerRenderError('LaTeX source position is unavailable for anti AI markers');
    const active = markers.filter((marker) => !handled.has(marker.id) && marker.offset >= position.start && marker.offset <= position.end);
    if (!active.length) continue;
    const wrapper: HastNode = { type: 'element', tagName: 'span', properties: {}, children: [child], position: child.position };
    for (const marker of active) {
      const side = marker.offset === position.start ? 'start' : marker.offset === position.end ? 'end' : 'full';
      if (side === 'full') {
        const mapped = formulaTextIndex(source, child, marker.offset);
        decorateAtomicFullMarker(wrapper, marker.id, mapped.source, mapped.index);
      } else decorateAtomicMarker(wrapper, marker.id, side);
      handled.add(marker.id);
    }
    node.children[index] = wrapper;
  }
}

function splitTextPosition(position: SourcePosition | undefined, offset: number, side: 'before' | 'after'): SourcePosition | undefined {
  if (!position) return undefined;
  return side === 'before' ? { ...position, end: { ...position.end, offset } } : { ...position, start: { ...position.start, offset } };
}

function textValue(node: HastNode): string {
  if (node.type === 'text') return node.value || '';
  return (node.children || []).map(textValue).join('');
}

function sourceOffsetToTextIndex(source: string, node: HastNode, offset: number, value: string): number {
  const position = bounds(node);
  if (!position) return offset <= 0 ? 0 : value.length;
  if (offset <= position.start) return 0;
  if (offset >= position.end) return value.length;
  const raw = source.slice(position.start, position.end);
  if (raw === value) return offset - position.start;
  const exactStart = raw.indexOf(value);
  if (exactStart >= 0) {
    const relativeOffset = offset - position.start - exactStart;
    if (relativeOffset >= 0 && relativeOffset <= value.length) return relativeOffset;
  }
  const visible = value.endsWith('\n') ? value.slice(0, -1) : value;
  const visibleStart = visible ? raw.indexOf(visible) : -1;
  if (visibleStart >= 0) {
    const relativeOffset = offset - position.start - visibleStart;
    if (relativeOffset >= 0 && relativeOffset <= visible.length) return relativeOffset;
  }
  throw new AntiAiMarkerRenderError('Anti AI marker cannot be mapped to transformed Markdown text');
}

function insertAtTextIndex(node: HastNode, textIndex: number, marker: HastNode): boolean {
  const children = node.children;
  if (!children) return false;
  let cursor = 0;
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const length = textValue(child).length;
    if (textIndex > cursor + length) {
      cursor += length;
      continue;
    }
    if (child.type === 'text') {
      const value = child.value || '';
      const split = Math.max(0, Math.min(value.length, textIndex - cursor));
      const replacement: HastNode[] = [];
      if (split > 0) replacement.push({ ...child, value: value.slice(0, split), position: undefined });
      replacement.push(marker);
      if (split < value.length) replacement.push({ ...child, value: value.slice(split), position: undefined });
      children.splice(index, 1, ...replacement);
      return true;
    }
    if (insertAtTextIndex(child, textIndex - cursor, marker)) return true;
    if (textIndex === cursor) {
      children.splice(index, 0, marker);
      return true;
    }
    if (textIndex === cursor + length) {
      children.splice(index + 1, 0, marker);
      return true;
    }
    return false;
  }
  if (textIndex !== cursor) return false;
  children.push(marker);
  return true;
}

function insertMarker(source: string, node: HastNode, offset: number, marker: HastNode): boolean {
  const children = node.children;
  if (!children) return false;
  for (let index = 0; index < children.length; index++) {
    const child = children[index];
    const position = bounds(child);
    if (!position || offset < position.start || offset > position.end) continue;
    if (child.type === 'text') {
      const value = child.value || '';
      const split = sourceOffsetToTextIndex(source, child, offset, value);
      const replacement: HastNode[] = [];
      if (split > 0) replacement.push({ ...child, value: value.slice(0, split), position: splitTextPosition(child.position, offset, 'before') });
      replacement.push(marker);
      if (split < value.length) {
        replacement.push({ ...child, value: value.slice(split), position: splitTextPosition(child.position, offset, 'after') });
      }
      children.splice(index, 1, ...replacement);
      return true;
    }
    if (insertMarker(source, child, offset, marker)) return true;
    if (child.tagName === 'code') {
      return insertAtTextIndex(child, sourceOffsetToTextIndex(source, child, offset, textValue(child)), marker);
    }
    const positionedChildren = (child.children || [])
      .map((candidate, childIndex) => ({ childIndex, position: bounds(candidate) }))
      .filter((candidate): candidate is { childIndex: number; position: { start: number; end: number } } => candidate.position !== null);
    if (!positionedChildren.length) {
      if (offset === position.start || offset === position.end) {
        decorateAtomicMarker(child, marker.properties?.['data-anti-ai-marker-id'] as string, offset === position.start ? 'start' : 'end');
        return true;
      }
      throw new AntiAiMarkerRenderError('Anti AI marker cannot be mapped inside a transformed Markdown node');
    }
    child.children ||= [];
    const starting = positionedChildren.find((candidate) => candidate.position.start === offset);
    const ending = positionedChildren.findLast((candidate) => candidate.position.end === offset);
    if (!starting && !ending) throw new AntiAiMarkerRenderError('Anti AI marker is inside non-visible Markdown syntax');
    child.children.splice(starting?.childIndex ?? ending!.childIndex + 1, 0, marker);
    return true;
  }
  const positionedChildren = children
    .map((child, index) => ({ index, position: bounds(child) }))
    .filter((candidate): candidate is { index: number; position: { start: number; end: number } } => candidate.position !== null);
  if (!positionedChildren.length) return false;
  const starting = positionedChildren.find((candidate) => candidate.position.start === offset);
  const ending = positionedChildren.findLast((candidate) => candidate.position.end === offset);
  if (!starting && !ending) return false;
  children.splice(starting?.index ?? ending!.index + 1, 0, marker);
  return true;
}

export function createAntiAiMarkerRehypePlugins(source: string, markers: readonly AntiAiMarkerClientMarker[]) {
  const handledByTree = new WeakMap<object, Set<string>>();
  const beforeKatex = () => (tree: unknown) => {
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) throw new TypeError('Markdown render tree is invalid');
    const handled = new Set<string>();
    handledByTree.set(tree, handled);
    wrapMathMarkers(source, tree as HastNode, markers, handled);
  };
  const afterTransforms = () => (tree: unknown) => {
    if (!tree || typeof tree !== 'object' || Array.isArray(tree)) throw new TypeError('Markdown render tree is invalid');
    const root = tree as HastNode;
    const handled = handledByTree.get(tree);
    if (!handled) throw new AntiAiMarkerRenderError('Anti AI marker transform state is unavailable');
    handledByTree.delete(tree);
    for (const marker of [...markers]
      .filter((candidate) => !handled.has(candidate.id))
      .sort((left, right) => left.offset - right.offset || right.id.localeCompare(left.id))) {
      if (marker.offset > source.length || !insertMarker(source, root, marker.offset, markerNode(marker.id))) {
        throw new AntiAiMarkerRenderError(`Anti AI marker cannot be rendered: ${marker.id}`);
      }
    }
  };
  return { beforeKatex, afterTransforms };
}

function containsNode(root: HTMLElement, node: Node): boolean {
  return root === node || root.contains(node);
}

function rangeContainsNode(range: Range, node: Node): boolean {
  return range.intersectsNode(node);
}

function markerId(element: Element): string | null {
  const value = element.getAttribute('data-anti-ai-marker-id');
  return value && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : null;
}

function atomicMarkerIds(element: Element, attribute: string): string[] {
  const value = element.getAttribute(attribute);
  if (!value) return [];
  const ids = value.split(' ').filter(Boolean);
  if (!ids.length || ids.some((id) => !/^[A-Za-z0-9_-]{8,64}$/.test(id))) throw new TypeError('Rendered atomic marker is invalid');
  return ids;
}

function rangeContainsAtomicBoundary(range: Range, element: Element, side: AtomicMarkerSide): boolean {
  if (side === 'full') {
    const visibleRoot = element.querySelector('.katex-html') || element;
    const walker = document.createTreeWalker(visibleRoot, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    for (let current = walker.nextNode(); current; current = walker.nextNode()) {
      if (current.textContent?.length) textNodes.push(current as Text);
    }
    const first = textNodes[0];
    const last = textNodes.at(-1);
    return !!first && !!last && range.comparePoint(first, 0) === 0 && range.comparePoint(last, last.data.length) === 0;
  }
  const parent = element.parentNode;
  if (!parent) return false;
  const index = Array.prototype.indexOf.call(parent.childNodes, element) as number;
  if (index < 0) return false;
  const strictlyCrosses = (offset: number) => {
    const boundary = document.createRange();
    boundary.setStart(parent, offset);
    boundary.collapse(true);
    return range.compareBoundaryPoints(Range.START_TO_START, boundary) < 0 && range.compareBoundaryPoints(Range.END_TO_END, boundary) > 0;
  };
  const crossesStart = strictlyCrosses(index);
  const crossesEnd = strictlyCrosses(index + 1);
  if (side === 'start') return crossesStart;
  return crossesEnd;
}

function observableCopyError(
  error: unknown,
  stage: string,
  contextId?: string,
  operation: 'copy' | 'cut' = 'copy',
  mimeType?: 'text/plain' | 'text/html',
) {
  const context = { stage, operation, contextId: contextId || 'unavailable', ...(mimeType ? { mimeType } : {}) };
  return error instanceof Error
    ? { ...context, name: error.name, message: error.message, stack: error.stack || 'stack-unavailable' }
    : { ...context, name: 'unknown', message: 'non-error thrown', stack: 'stack-unavailable' };
}

interface AtomicFormulaIndex {
  id: string;
  index: number;
}

function atomicFormula(element: Element): { source: string; indexes: AtomicFormulaIndex[] } {
  const source = element.getAttribute(ATOMIC_SOURCE_ATTRIBUTE);
  const rawIndexes = element.getAttribute(ATOMIC_INDEXES_ATTRIBUTE);
  if (source === null || rawIndexes === null) throw new TypeError('Rendered atomic formula metadata is missing');
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawIndexes);
  } catch {
    throw new TypeError('Rendered atomic formula metadata is invalid');
  }
  if (!Array.isArray(parsed)) throw new TypeError('Rendered atomic formula metadata is invalid');
  const ids = new Set<string>();
  const indexes = parsed.map((entry) => {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      Object.keys(entry).sort().join(',') !== 'id,index' ||
      typeof (entry as { id?: unknown }).id !== 'string' ||
      !/^[A-Za-z0-9_-]{8,64}$/.test((entry as { id: string }).id) ||
      ids.has((entry as { id: string }).id) ||
      !Number.isSafeInteger((entry as { index?: unknown }).index) ||
      Number((entry as { index: number }).index) < 0 ||
      Number((entry as { index: number }).index) > source.length
    ) {
      throw new TypeError('Rendered atomic formula metadata is invalid');
    }
    const id = (entry as { id: string }).id;
    ids.add(id);
    return { id, index: Number((entry as { index: number }).index) };
  });
  const fullIds = atomicMarkerIds(element, ATOMIC_FULL_ATTRIBUTE);
  if (fullIds.length !== indexes.length || fullIds.some((id) => !ids.has(id))) {
    throw new TypeError('Rendered atomic formula metadata is incomplete');
  }
  return { source, indexes };
}

function boundaryNewlines(node: Node): number {
  if (!(node instanceof Element)) return 0;
  const tag = node.tagName;
  if (['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'PRE'].includes(tag)) return 2;
  if (['LI', 'TR', 'THEAD', 'TBODY', 'TFOOT', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'FIGURE', 'FIGCAPTION'].includes(tag)) {
    return 1;
  }
  return 0;
}

function ensureTrailingNewlines(value: string, count: number): string {
  if (!count) return value;
  const trailing = value.match(/\n*$/u)?.[0].length || 0;
  return trailing >= count ? value : `${value}${'\n'.repeat(count - trailing)}`;
}

function plainTextFromNode(node: Node, preserveWhitespace = false): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
  if (!(node instanceof Element) && !(node instanceof DocumentFragment)) return '';
  const preserveChildWhitespace = preserveWhitespace || (node instanceof Element && (node.tagName === 'PRE' || node.tagName === 'CODE'));
  if (node instanceof Element) {
    if (node.tagName === 'BR') return '\n';
    if (node.tagName === 'HR') return '\n';
    if (node.tagName === 'TR') {
      return Array.from(node.children)
        .filter((child) => child.tagName === 'TD' || child.tagName === 'TH')
        .map((child) => plainTextFromNode(child, preserveChildWhitespace))
        .join('\t');
    }
    if (node.classList.contains('katex-mathml')) {
      let result = '';
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) {
          result += child.textContent || '';
          continue;
        }
        const annotation = node.querySelector('annotation[encoding="application/x-tex"]');
        result += annotation?.textContent || plainTextFromNode(child, preserveChildWhitespace);
        break;
      }
      return result;
    }
    if (node.classList.contains('katex-html')) {
      const hasMathmlSibling = Array.from(node.parentNode?.childNodes || []).some(
        (sibling) => sibling instanceof Element && sibling.classList.contains('katex-mathml'),
      );
      if (hasMathmlSibling) {
        return Array.from(node.childNodes)
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => plainTextFromNode(child, preserveChildWhitespace))
          .join('');
      }
    }
  }
  let result = '';
  let previousBoundary = 0;
  for (const child of Array.from(node.childNodes)) {
    const text = plainTextFromNode(child, preserveChildWhitespace);
    if (!preserveChildWhitespace && child.nodeType === Node.TEXT_NODE && text.includes('\n') && !text.trim()) continue;
    if (!text) continue;
    const currentBoundary = boundaryNewlines(child);
    if (result) result = ensureTrailingNewlines(result, Math.max(previousBoundary, currentBoundary));
    result += text;
    previousBoundary = currentBoundary;
  }
  return result;
}

function outermostCarriers(elements: Element[]): Element[] {
  return elements.filter((element) => !elements.some((candidate) => candidate !== element && candidate.contains(element)));
}

export function AntiAiCopyBoundary({
  markers,
  contextId,
  children,
}: {
  markers: readonly AntiAiMarkerClientMarker[];
  contextId?: string;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [copyError, setCopyError] = useState(false);
  const injectionById = useMemo(() => new Map(markers.map((marker) => [marker.id, marker.injectionText])), [markers]);
  const handleCopy = useCallback(
    (event: ClipboardEvent<HTMLDivElement>) => {
      const root = rootRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.rangeCount !== 1 || selection.isCollapsed) return;
      const range = selection.getRangeAt(0);
      if (!containsNode(root, range.startContainer) || !containsNode(root, range.endContainer)) return;
      const operation = event.type === 'cut' ? 'cut' : 'copy';
      const clipboard = event.clipboardData;
      let intercepted = false;
      try {
        const selectedMarkers = Array.from(root.querySelectorAll('[data-anti-ai-marker-id]')).filter((element) => rangeContainsNode(range, element));
        if (selectedMarkers.length) {
          event.preventDefault();
          intercepted = true;
        }
        const selectedAtomicMarkers = new Map<string, AtomicMarkerSide>();
        const selectedFullCarriers = new Set<Element>();
        for (const element of Array.from(
          root.querySelectorAll(`[${ATOMIC_START_ATTRIBUTE}], [${ATOMIC_END_ATTRIBUTE}], [${ATOMIC_FULL_ATTRIBUTE}]`),
        )) {
          for (const side of ['start', 'full', 'end'] as const) {
            const attribute = atomicAttribute(side);
            if (!rangeContainsAtomicBoundary(range, element, side)) continue;
            if (!intercepted) {
              event.preventDefault();
              intercepted = true;
            }
            for (const id of atomicMarkerIds(element, attribute)) {
              const existing = selectedAtomicMarkers.get(id);
              if (existing && existing !== side) throw new TypeError('Rendered atomic marker has conflicting sides');
              selectedAtomicMarkers.set(id, side);
              if (side === 'full') selectedFullCarriers.add(element);
            }
          }
        }
        if (!selectedMarkers.length && !selectedAtomicMarkers.size) return;
        if (!clipboard) throw new TypeError('clipboardData is unavailable');
        const selectedBoundaryIds = selectedMarkers.map((element) => {
          const id = markerId(element);
          const injectionText = id ? injectionById.get(id) : undefined;
          if (!id || injectionText === undefined) throw new TypeError('Rendered anti AI marker is not trusted');
          return id;
        });
        for (const id of selectedAtomicMarkers.keys()) {
          if (!injectionById.has(id)) throw new TypeError('Rendered atomic marker is not trusted');
        }
        const fragment = range.cloneContents();
        const clonedMarkers = Array.from(fragment.querySelectorAll('[data-anti-ai-marker-id]'));
        if (clonedMarkers.length !== selectedBoundaryIds.length) throw new TypeError('Selected anti AI marker clone is incomplete');
        for (const element of clonedMarkers) {
          const id = markerId(element);
          const injectionText = id ? injectionById.get(id) : undefined;
          if (!id || injectionText === undefined || !selectedBoundaryIds.includes(id)) {
            throw new TypeError('Cloned anti AI marker is not trusted');
          }
          element.replaceWith(document.createTextNode(injectionText));
        }
        const markerOrder = new Map(markers.map((marker, index) => [marker.id, index]));
        const orderIds = (ids: readonly string[]) => [...ids].sort((left, right) => markerOrder.get(left)! - markerOrder.get(right)!);
        const serializedAtomicIds = new Set<string>();
        const serializeFormula = (carrier: Element) => {
          const selectedFullIds = orderIds(atomicMarkerIds(carrier, ATOMIC_FULL_ATTRIBUTE).filter((id) => selectedAtomicMarkers.get(id) === 'full'));
          if (!selectedFullIds.length) return null;
          const metadata = atomicFormula(carrier);
          const indexById = new Map(metadata.indexes.map((entry) => [entry.id, entry.index]));
          const positioned = selectedFullIds
            .map((id) => ({ id, index: indexById.get(id) }))
            .sort((left, right) => Number(left.index) - Number(right.index) || markerOrder.get(left.id)! - markerOrder.get(right.id)!);
          if (positioned.some((entry) => entry.index === undefined)) throw new TypeError('Selected atomic formula marker metadata is incomplete');
          let formula = '';
          let cursor = 0;
          for (const entry of positioned) {
            const index = Number(entry.index);
            formula += metadata.source.slice(cursor, index);
            formula += injectionById.get(entry.id);
            cursor = index;
          }
          formula += metadata.source.slice(cursor);
          const selectedStartIds = orderIds(
            atomicMarkerIds(carrier, ATOMIC_START_ATTRIBUTE).filter((id) => selectedAtomicMarkers.get(id) === 'start'),
          );
          const selectedEndIds = orderIds(atomicMarkerIds(carrier, ATOMIC_END_ATTRIBUTE).filter((id) => selectedAtomicMarkers.get(id) === 'end'));
          return {
            ids: [...selectedStartIds, ...selectedFullIds, ...selectedEndIds],
            text: `${selectedStartIds.map((id) => injectionById.get(id)).join('')}${formula}${selectedEndIds
              .map((id) => injectionById.get(id))
              .join('')}`,
          };
        };
        const fullCarriers = outermostCarriers(Array.from(fragment.querySelectorAll(`[${ATOMIC_FULL_ATTRIBUTE}]`)));
        for (const carrier of fullCarriers) {
          const serialized = serializeFormula(carrier);
          if (!serialized) continue;
          const copiedFormula = document.createElement('span');
          copiedFormula.textContent = serialized.text;
          carrier.replaceWith(copiedFormula);
          for (const id of serialized.ids) serializedAtomicIds.add(id);
        }
        const unresolvedFullIds = [...selectedAtomicMarkers.entries()]
          .filter(([id, side]) => side === 'full' && !serializedAtomicIds.has(id))
          .map(([id]) => id);
        if (unresolvedFullIds.length && selectedFullCarriers.size === 1) {
          const carrier = [...selectedFullCarriers][0];
          if (carrier.contains(range.startContainer) && carrier.contains(range.endContainer)) {
            const serialized = serializeFormula(carrier);
            if (!serialized || unresolvedFullIds.some((id) => !serialized.ids.includes(id))) {
              throw new TypeError('Selected atomic formula clone is incomplete');
            }
            const copiedFormula = document.createElement('span');
            copiedFormula.textContent = serialized.text;
            fragment.replaceChildren(copiedFormula);
            for (const id of serialized.ids) serializedAtomicIds.add(id);
          }
        }
        for (const side of ['start', 'full', 'end'] as const) {
          const attribute = atomicAttribute(side);
          let ids = [...selectedAtomicMarkers.entries()]
            .filter((entry) => entry[1] === side)
            .map((entry) => entry[0])
            .filter((id) => !serializedAtomicIds.has(id))
            .sort((left, right) => markers.findIndex((marker) => marker.id === left) - markers.findIndex((marker) => marker.id === right));
          if (side === 'start') ids = ids.reverse();
          for (const id of ids) {
            const carriers = outermostCarriers(
              Array.from(fragment.querySelectorAll(`[${attribute}]`)).filter((element) => atomicMarkerIds(element, attribute).includes(id)),
            );
            const target = side === 'start' ? carriers[0] : carriers.at(-1);
            const injectionText = injectionById.get(id);
            if (!target || injectionText === undefined) throw new TypeError('Selected atomic marker clone is incomplete');
            if (side === 'start') target.prepend(document.createTextNode(injectionText));
            else target.append(document.createTextNode(injectionText));
          }
        }
        for (const element of Array.from(
          fragment.querySelectorAll(`[${ATOMIC_START_ATTRIBUTE}], [${ATOMIC_END_ATTRIBUTE}], [${ATOMIC_FULL_ATTRIBUTE}]`),
        )) {
          element.removeAttribute(ATOMIC_START_ATTRIBUTE);
          element.removeAttribute(ATOMIC_END_ATTRIBUTE);
          element.removeAttribute(ATOMIC_FULL_ATTRIBUTE);
          element.removeAttribute(ATOMIC_SOURCE_ATTRIBUTE);
          element.removeAttribute(ATOMIC_INDEXES_ATTRIBUTE);
        }
        const wrapper = document.createElement('div');
        const plain = plainTextFromNode(fragment);
        wrapper.append(fragment.cloneNode(true));
        clipboard.setData('text/html', wrapper.innerHTML);
        clipboard.setData('text/plain', plain);
      } catch (error) {
        if (!intercepted) event.preventDefault();
        for (const mimeType of ['text/plain', 'text/html'] as const) {
          try {
            clipboard?.clearData(mimeType);
          } catch (cleanupError) {
            console.warn(
              'Controlled statement clipboard cleanup failed',
              observableCopyError(cleanupError, 'clipboard-cleanup', contextId, operation, mimeType),
            );
          }
        }
        console.warn('Controlled statement copy failed', observableCopyError(error, 'clipboard-write', contextId, operation));
        setCopyError(true);
        return;
      }
      setCopyError(false);
    },
    [contextId, injectionById, markers],
  );

  return (
    <div>
      <div ref={rootRef} data-anti-ai-copy-scope onCopy={handleCopy} onCut={handleCopy}>
        {children}
      </div>
      {copyError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          复制或剪切失败：浏览器无法同时写入纯文本和富文本，请重试或更换浏览器。
        </p>
      ) : null}
    </div>
  );
}
