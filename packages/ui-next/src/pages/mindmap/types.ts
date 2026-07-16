export interface MindmapNode {
  _id: string;
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

export interface MindmapConfig {
  title: string;
  rootNodeId: string | null;
  layoutDirection: 'RIGHT' | 'DOWN';
  updatedAt: string;
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
  config: MindmapConfig;
  referenceCounts: Record<string, number>;
}
