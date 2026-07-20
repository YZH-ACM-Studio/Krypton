export interface MindmapNode {
  _id: string;
  mapId: string;
  parentId: string | null;
  topic: string;
  description?: string;
  color?: string;
  layoutSide?: 'left' | 'right';
  tags: string[];
  problemIds: string[];
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeMap {
  _id: string;
  title: string;
  rootNodeId: string | null;
  visibility: 'hidden' | 'public';
  layoutDirection: 'RIGHT' | 'DOWN';
  createdAt: string;
  updatedAt: string;
}

export type MindmapConfig = KnowledgeMap;

export interface KnowledgeMapOption extends KnowledgeMap {
  usage?: { nodes: number; problems: number; courses: number };
}

export interface PanelProblem {
  domainId: string;
  docId: number;
  pid: string;
  title: string;
  hidden: boolean;
  nSubmit: number;
  nAccept: number;
  difficulty: number;
  sources: Array<'tag' | 'manual'>;
}

export interface ProblemOption {
  domainId: string;
  docId: number;
  pid: string;
  title: string;
  hidden: boolean;
}

export interface MindmapSnapshot {
  nodes: MindmapNode[];
  config: KnowledgeMap | null;
  maps: KnowledgeMapOption[];
  referenceCounts: Record<string, number>;
}
