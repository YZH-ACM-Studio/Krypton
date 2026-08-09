import { createRequestId } from '@/lib/request-id';

export interface AntiAiMarkerDraft {
  id: string;
  anchor: {
    path: string;
    offset: number;
    affinity: 'before' | 'after';
  };
  injectionText: string;
  revision: number;
  conflict?: string;
}

export interface AntiAiMarkerInput {
  schemaVersion: 1;
  markers: Array<{
    id: string;
    anchor: AntiAiMarkerDraft['anchor'];
    injectionText: string;
    revision: number;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

export function readAntiAiMarkerDrafts(value: unknown): AntiAiMarkerDraft[] {
  if (value === undefined) return [];
  if (!isRecord(value) || !hasExactKeys(value, ['schemaVersion', 'markers']) || value.schemaVersion !== 1 || !Array.isArray(value.markers)) {
    throw new TypeError('antiAiMarkers schema is invalid');
  }
  const ids = new Set<string>();
  return value.markers.map((raw, index) => {
    if (
      !isRecord(raw) ||
      !hasExactKeys(raw, ['id', 'anchor', 'injectionText', 'revision']) ||
      !isRecord(raw.anchor) ||
      !hasExactKeys(raw.anchor, ['path', 'offset', 'affinity', 'before', 'after'])
    ) {
      throw new TypeError(`antiAiMarkers marker ${index} is invalid`);
    }
    if (
      typeof raw.id !== 'string' ||
      !raw.id ||
      ids.has(raw.id) ||
      typeof raw.anchor.path !== 'string' ||
      !Number.isSafeInteger(raw.anchor.offset) ||
      Number(raw.anchor.offset) < 0 ||
      (raw.anchor.affinity !== 'before' && raw.anchor.affinity !== 'after') ||
      typeof raw.injectionText !== 'string' ||
      raw.injectionText.length === 0 ||
      !Number.isSafeInteger(raw.revision) ||
      Number(raw.revision) < 1
    ) {
      throw new TypeError(`antiAiMarkers marker ${index} is invalid`);
    }
    ids.add(raw.id);
    return {
      id: raw.id,
      anchor: {
        path: raw.anchor.path,
        offset: Number(raw.anchor.offset),
        affinity: raw.anchor.affinity,
      },
      injectionText: raw.injectionText,
      revision: Number(raw.revision),
    };
  });
}

function markerId(): string {
  return `marker_${createRequestId().replaceAll('-', '')}`;
}

export function createAntiAiMarker(
  path: string,
  offset: number,
  injectionText: string,
  affinity: 'before' | 'after' = 'after',
  id = markerId(),
): AntiAiMarkerDraft {
  return { id, anchor: { path, offset, affinity }, injectionText, revision: 0 };
}

function singleSplice(before: string, after: string) {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  ) {
    suffix += 1;
  }
  return {
    from: prefix,
    oldTo: before.length - suffix,
    newTo: after.length - suffix,
  };
}

export function remapAntiAiMarkers(markers: AntiAiMarkerDraft[], path: string, before: string, after: string): AntiAiMarkerDraft[] {
  if (before === after) return markers;
  const change = singleSplice(before, after);
  const removed = change.oldTo - change.from;
  const inserted = change.newTo - change.from;
  const delta = inserted - removed;
  return markers.map((marker) => {
    if (marker.anchor.path !== path) return marker;
    if (marker.conflict) return marker;
    const offset = marker.anchor.offset;
    if (removed > 0 && offset > change.from && offset < change.oldTo) {
      return { ...marker, conflict: '题面编辑跨过了此标记，请重新定位或删除后再保存。' };
    }
    if (removed > 0 && offset === change.from && change.oldTo > change.from && marker.anchor.affinity === 'after') {
      return { ...marker, conflict: '题面编辑跨过了此标记，请重新定位或删除后再保存。' };
    }
    if (removed > 0 && offset === change.oldTo && marker.anchor.affinity === 'before') {
      return { ...marker, conflict: '题面编辑跨过了此标记，请重新定位或删除后再保存。' };
    }
    let nextOffset = offset;
    if (offset > change.oldTo || (offset === change.oldTo && marker.anchor.affinity === 'after')) nextOffset += delta;
    else if (offset === change.from && removed === 0 && marker.anchor.affinity === 'after') nextOffset += inserted;
    return { ...marker, anchor: { ...marker.anchor, offset: nextOffset }, conflict: undefined };
  });
}

export function serializeAntiAiMarkerInput(markers: AntiAiMarkerDraft[]): AntiAiMarkerInput {
  const conflict = markers.find((marker) => marker.conflict);
  if (conflict) throw new Error(`防 AI 标记 ${conflict.id} 尚未重新定位。`);
  const empty = markers.find((marker) => !marker.injectionText.length);
  if (empty) throw new Error(`防 AI 标记 ${empty.id} 尚未填写注入文本。`);
  return {
    schemaVersion: 1,
    markers: markers.map((marker) => ({
      id: marker.id,
      anchor: { ...marker.anchor },
      injectionText: marker.injectionText,
      revision: marker.revision,
    })),
  };
}

export function antiAiCopyPreview(source: string, markers: AntiAiMarkerDraft[]): string {
  const active = markers
    .filter((marker) => !marker.conflict && marker.anchor.offset <= source.length)
    .sort((left, right) => right.anchor.offset - left.anchor.offset || right.id.localeCompare(left.id));
  let result = source;
  for (const marker of active) {
    result = `${result.slice(0, marker.anchor.offset)}${marker.injectionText}${result.slice(marker.anchor.offset)}`;
  }
  return result;
}
