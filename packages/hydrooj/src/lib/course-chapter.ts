import type { TrainingSection } from '../interface';
import { parseCourseVideos } from './course-video';

/** Reads only the pid arrays, so callers may pass any chapter-shaped projection. */
export function courseNodePids<T extends { pids?: number[]; sections?: { pids?: number[] }[] }>(node: T): number[] {
    return Array.from(new Set([...(node.pids || []), ...((node.sections || []).flatMap((section) => section.pids || []))]));
}

export function parseCourseSections(
    chapterId: number,
    raw: unknown,
    pidsOf: (value: unknown) => number[],
): TrainingSection[] {
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw)) throw new Error(`章节 ${chapterId} 的小节必须是数组`);
    const ids = new Set<number>();
    const seenPids = new Set<number>();
    const sections: TrainingSection[] = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
            throw new Error(`章节 ${chapterId} 含无效小节`);
        }
        const node = item as Record<string, unknown>;
        const extraKeys = Object.keys(node).filter((key) => !['content', 'pids', 'title', '_id', 'videos'].includes(key));
        if (extraKeys.length) {
            throw new Error(`章节 ${chapterId} 的小节含未知字段 ${extraKeys.join(', ')}`);
        }
        if (typeof node._id !== 'number' || !Number.isSafeInteger(node._id) || node._id <= 0) {
            throw new Error(`章节 ${chapterId} 的小节需要正整数 _id`);
        }
        const id = node._id;
        if (ids.has(id)) throw new Error(`章节 ${chapterId} 的小节 _id 必须唯一`);
        ids.add(id);
        if (typeof node.title !== 'string') throw new Error(`章节 ${chapterId} 的小节标题必须是字符串`);
        const title = node.title.trim();
        if (!title) throw new Error(`章节 ${chapterId} 的每个小节需要标题`);
        if (node.content !== undefined && typeof node.content !== 'string') {
            throw new Error(`章节 ${chapterId} 小节 ${id} 的讲义必须是字符串`);
        }
        const pids = pidsOf(node.pids);
        for (const pid of pids) {
            if (seenPids.has(pid)) throw new Error(`章节 ${chapterId} 的题目不能属于多个小节`);
            seenPids.add(pid);
        }
        const videos = parseCourseVideos(`章节 ${chapterId} 小节 ${id}`, node.videos);
        sections.push({
            _id: id,
            title,
            ...(node.content ? { content: String(node.content) } : {}),
            pids,
            ...(videos.length ? { videos } : {}),
        });
    }
    return sections;
}
