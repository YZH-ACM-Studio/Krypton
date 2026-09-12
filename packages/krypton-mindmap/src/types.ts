import type { ObjectId } from 'mongodb';

/** A node belongs to exactly one knowledge map. */
export interface MindmapNode {
    _id: ObjectId;
    mapId: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    description?: string;
    /** Tailwind color name: gray, sky, blue, green, amber, rose, purple. */
    color?: string;
    /** Only meaningful for direct children of the configured root. */
    layoutSide?: 'left' | 'right';
    /** Hydro problem tags — used to auto-fetch problems for the node panel. */
    tags: string[];
    /** Manually-pinned problem PIDs. Union with `tags`-matched problems. */
    problemIds: string[];
    /** Sibling ordering within the same parent (smaller = first). */
    order: number;
    createdAt: Date;
    updatedAt: Date;
}

/** First-class reusable knowledge map. */
export interface KnowledgeMapDoc {
    _id: ObjectId;
    title: string;
    rootNodeId: ObjectId;
    visibility: 'hidden' | 'public';
    layoutDirection: 'RIGHT' | 'DOWN';
    createdAt: Date;
    updatedAt: Date;
}

export interface MindmapMaterializeOptions {
    required?: boolean;
    requirePublicMap?: boolean;
    field?: 'knowledgeNodeIds' | 'mindmapNodeIds';
    includePathVersion?: boolean;
}

export interface MindmapPathVersion {
    id: string;
    parentId: string | null;
    topic: string;
    updatedAt: string;
}

export interface MindmapMaterializeResult {
    mapId: ObjectId;
    mapTitle: string;
    nodeIds: ObjectId[];
    nodePaths: Array<{ id: string; label: string }>;
    tags: string[];
    pathVersion?: MindmapPathVersion[];
}
