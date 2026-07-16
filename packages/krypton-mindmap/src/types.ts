import type { ObjectId } from 'mongodb';

/**
 * MindmapNode — one node in the single global mindmap. Tree is implicit via
 * parentId; root node has parentId = null and config.rootNodeId points at it.
 *
 * Layout is derived from the tree and sibling order. Root branches may select
 * a relative side, but absolute x/y coordinates are deliberately unsupported.
 */
export interface MindmapNode {
    _id: ObjectId;
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
