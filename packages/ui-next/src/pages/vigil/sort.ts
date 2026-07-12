export const VIGIL_SORT_KEYS = ['status_priority', 'student_id', 'name', 'exam_time', 'event_count'] as const;

export type VigilSortKey = typeof VIGIL_SORT_KEYS[number];

export function parseVigilSortKey(value: string | null): VigilSortKey {
  return VIGIL_SORT_KEYS.includes(value as VigilSortKey) ? value as VigilSortKey : 'student_id';
}
