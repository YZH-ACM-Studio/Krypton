import type { ObjectId } from 'mongodb';

/**
 * MindmapNode — one node in the single global mindmap. Tree is implicit via
 * parentId; root node has parentId = null and config.rootNodeId points at it.
 *
 * `position` is the manual layout override — when set, ELK auto-layout is
 * skipped for that node and the saved x/y is used instead. Admin "reset
 * layout" clears all positions.
 */
export interface MindmapNode {
    _id: ObjectId;
    parentId: ObjectId | null;
    topic: string;
    description?: string;
    /** Tailwind color name: gray, sky, blue, green, amber, rose, purple. */
    color?: string;
    position?: { x: number; y: number };
    /** Hydro problem tags — used to auto-fetch problems for the node panel. */
    tags: string[];
    /** Manually-pinned problem PIDs. Union with `tags`-matched problems. */
    problemIds: string[];
    /** Sibling ordering within the same parent (smaller = first). */
    order: number;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * MindmapConfig — singleton document with `_id: 'global'`. Holds the title,
 * the rootNodeId, and the layout direction.
 */
export interface MindmapConfig {
    _id: 'global';
    title: string;
    rootNodeId: ObjectId | null;
    layoutDirection: 'RIGHT' | 'DOWN';
    updatedAt: Date;
}
