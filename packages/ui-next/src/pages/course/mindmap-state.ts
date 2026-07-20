import type { CourseMindmapProblem } from './types';

export function problemsForCourseMindmapNode(problems: CourseMindmapProblem[], nodeId: string | null): CourseMindmapProblem[] {
  if (!nodeId) return [];
  return problems.filter((problem) => problem.nodeIds.includes(nodeId));
}
