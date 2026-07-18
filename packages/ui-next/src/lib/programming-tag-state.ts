export interface ProgrammingTagState {
  mode: 'managed' | 'converted' | 'unconverted';
  sourceTags: string[];
  selectedNodeIds: string[];
  suggestions?: Array<{ tag: string; nodeId: string; label: string }>;
  ambiguousTags?: Array<{ tag: string; candidates: string[] }>;
  unknownTags?: string[];
}

export function requiresLegacyProgrammingTagNormalization(state: ProgrammingTagState): boolean {
  if (state.mode !== 'unconverted') return false;
  return !!(state.suggestions?.length || state.ambiguousTags?.length || state.unknownTags?.length);
}
