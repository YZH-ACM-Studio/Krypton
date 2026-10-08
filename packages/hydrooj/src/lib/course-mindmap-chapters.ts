import type { TrainingNode, TrainingSection } from '../interface';

const NODE_ID = /^[a-f0-9]{24}$/;
const BODY_MAX = 20_000;
const PLACEHOLDER_TITLE = /^第 \d+ 章$/;

export type CourseChapterGenerateCode = 'empty' | 'broken' | 'topic' | 'newline' | 'body' | 'duplicate';

export class CourseChapterGenerateError extends Error {
    readonly code: CourseChapterGenerateCode;

    constructor(code: CourseChapterGenerateCode) {
        super(code);
        this.name = 'CourseChapterGenerateError';
        this.code = code;
    }
}

export interface MindmapChapterSourceNode {
    id: string;
    parentId: string | null;
    topic: string;
    description?: string;
    order: number;
}

export interface MindmapChapterApplyResult {
    dag: TrainingNode[];
    createdChapters: number;
    createdSections: number;
    removedChapters: number;
    removedSections: number;
    notices: string[];
}

interface MindmapSourceFields {
    sourceMindmapNodeId?: string;
    sourceMindmapBody?: string;
}

interface TreeNode extends MindmapChapterSourceNode {
    children: TreeNode[];
}

interface StoredSection {
    chapter: TrainingNode;
    section: TrainingSection;
}

/** Reads the optional link a saved chapter or section keeps back to one mindmap node. */
export function readStoredMindmapChapterSource(
    node: {
        sourceMindmapNodeId?: unknown;
        sourceMindmapBody?: unknown;
    },
    label: string,
): MindmapSourceFields {
    const result: MindmapSourceFields = {};
    if (node.sourceMindmapNodeId !== undefined && node.sourceMindmapNodeId !== null && node.sourceMindmapNodeId !== '') {
        if (typeof node.sourceMindmapNodeId !== 'string' || !NODE_ID.test(node.sourceMindmapNodeId)) {
            throw new Error(`${label} 的导图节点无效`);
        }
        result.sourceMindmapNodeId = node.sourceMindmapNodeId;
    }
    if (node.sourceMindmapBody !== undefined && node.sourceMindmapBody !== null && node.sourceMindmapBody !== '') {
        if (typeof node.sourceMindmapBody !== 'string' || node.sourceMindmapBody.length > BODY_MAX) {
            throw new Error(`${label} 的导图正文记录无效`);
        }
        result.sourceMindmapBody = node.sourceMindmapBody;
    }
    if (result.sourceMindmapBody && !result.sourceMindmapNodeId) {
        throw new Error(`${label} 的导图正文记录缺少节点`);
    }
    return result;
}

export function assertUniqueCourseMindmapSources(dag: TrainingNode[]): void {
    const seen = new Set<string>();
    const claim = (id: string | undefined) => {
        if (!id) return;
        if (seen.has(id)) throw new CourseChapterGenerateError('duplicate');
        seen.add(id);
    };
    for (const chapter of dag) {
        claim(chapter.sourceMindmapNodeId);
        for (const section of chapter.sections || []) claim(section.sourceMindmapNodeId);
    }
}

/** Copied courses do not copy the owned map, so generated links must not follow them. */
export function stripCourseMindmapChapterSources(dag: TrainingNode[]): TrainingNode[] {
    return dag.map((chapter) => {
        const { sourceMindmapNodeId: _chapterNode, sourceMindmapBody: _chapterBody, sections, ...rest } = chapter;
        return {
            ...rest,
            ...(sections
                ? {
                      sections: sections.map((section) => {
                          const { sourceMindmapNodeId: _sectionNode, sourceMindmapBody: _sectionBody, ...sectionRest } = section;
                          return sectionRest;
                      }),
                  }
                : {}),
        };
    });
}

function buildTree(nodes: MindmapChapterSourceNode[], rootId: string): { root: TreeNode; byId: Map<string, TreeNode> } {
    if (!NODE_ID.test(rootId)) throw new CourseChapterGenerateError('broken');
    const byId = new Map<string, TreeNode>();
    for (const node of nodes) {
        if (!NODE_ID.test(node.id) || byId.has(node.id)) throw new CourseChapterGenerateError('broken');
        if (node.parentId !== null && !NODE_ID.test(node.parentId)) throw new CourseChapterGenerateError('broken');
        if (typeof node.topic !== 'string') throw new CourseChapterGenerateError('topic');
        if (node.topic.includes('\n') || node.topic.includes('\r')) throw new CourseChapterGenerateError('newline');
        const topic = node.topic.trim();
        if (!topic || topic.length > 100) throw new CourseChapterGenerateError('topic');
        if (node.description !== undefined && node.description !== null) {
            if (typeof node.description !== 'string' || node.description.length > 2000) throw new CourseChapterGenerateError('broken');
        }
        if (!Number.isSafeInteger(node.order)) throw new CourseChapterGenerateError('broken');
        const description = typeof node.description === 'string' ? node.description.trim() : '';
        byId.set(node.id, {
            id: node.id,
            parentId: node.parentId,
            topic,
            ...(description ? { description } : {}),
            order: node.order,
            children: [],
        });
    }
    const root = byId.get(rootId);
    if (!root || root.parentId !== null) throw new CourseChapterGenerateError('broken');
    for (const node of byId.values()) {
        if (node.id === rootId) continue;
        if (!node.parentId) throw new CourseChapterGenerateError('broken');
        const parent = byId.get(node.parentId);
        if (!parent) throw new CourseChapterGenerateError('broken');
        parent.children.push(node);
    }
    const seen = new Set<string>();
    const walk = (node: TreeNode) => {
        if (seen.has(node.id)) throw new CourseChapterGenerateError('broken');
        seen.add(node.id);
        node.children.sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
        for (const child of node.children) walk(child);
    };
    walk(root);
    if (seen.size !== byId.size) throw new CourseChapterGenerateError('broken');
    return { root, byId };
}

function outline(nodes: TreeNode[], depth: number): string[] {
    const lines: string[] = [];
    const pad = '  '.repeat(depth);
    for (const node of nodes) {
        lines.push(`${pad}- ${node.topic}`);
        if (node.description) {
            for (const line of node.description.split('\n')) lines.push(`${pad}  ${line}`);
        }
        lines.push(...outline(node.children, depth + 1));
    }
    return lines;
}

function generatedBody(description: string | undefined, descendants: TreeNode[]): string {
    const parts: string[] = [];
    if (description) parts.push(description);
    if (descendants.length) parts.push(outline(descendants, 0).join('\n'));
    const body = parts.join('\n\n');
    if (body.length > BODY_MAX) throw new CourseChapterGenerateError('body');
    return body;
}

function applyBody(
    current: string | undefined,
    stored: string | undefined,
    next: string,
): MindmapSourceFields & { content?: string; skipped: boolean } {
    const currentText = current || '';
    const storedText = stored || '';
    if (currentText === '' || currentText === storedText) {
        return {
            ...(next ? { content: next, sourceMindmapBody: next } : {}),
            skipped: false,
        };
    }
    return {
        ...(currentText ? { content: currentText } : {}),
        ...(storedText ? { sourceMindmapBody: storedText } : {}),
        skipped: true,
    };
}

function sectionHasTeacherContent(section: TrainingSection): boolean {
    if (section.videos?.length || section.pids?.length) return true;
    const current = section.content || '';
    const stored = section.sourceMindmapBody || '';
    return current !== '' && current !== stored;
}

function chapterHasTeacherContent(chapter: TrainingNode): boolean {
    if (chapter.videos?.length || chapter.pids?.length || chapter.tids?.length || chapter.problemSetId || chapter.stageIds?.length) return true;
    if (chapter.requireNids?.length) return true;
    const current = chapter.content || '';
    const stored = chapter.sourceMindmapBody || '';
    return current !== '' && current !== stored;
}

function isPlaceholderChapter(chapter: TrainingNode): boolean {
    if (chapter.sourceMindmapNodeId || chapter.sections?.length) return false;
    if (chapterHasTeacherContent(chapter)) return false;
    const title = chapter.title.trim();
    return title === '第一章' || PLACEHOLDER_TITLE.test(title);
}

function cloneSection(section: TrainingSection): TrainingSection {
    return {
        ...section,
        pids: [...section.pids],
        ...(section.videos ? { videos: section.videos.map((video) => ({ ...video })) } : {}),
    };
}

function cloneChapter(chapter: TrainingNode): TrainingNode {
    return {
        ...chapter,
        pids: [...chapter.pids],
        requireNids: [...(chapter.requireNids || [])],
        ...(chapter.videos ? { videos: chapter.videos.map((video) => ({ ...video })) } : {}),
        ...(chapter.tids ? { tids: [...chapter.tids] } : {}),
        ...(chapter.stageIds ? { stageIds: [...chapter.stageIds] } : {}),
        ...(chapter.sections ? { sections: chapter.sections.map(cloneSection) } : {}),
    };
}

function withoutBody(node: TrainingNode | TrainingSection): void {
    delete node.content;
    delete node.sourceMindmapBody;
}

function writeBody(node: TrainingNode | TrainingSection, applied: { content?: string; sourceMindmapBody?: string }): void {
    withoutBody(node);
    if (applied.content) node.content = applied.content;
    if (applied.sourceMindmapBody) node.sourceMindmapBody = applied.sourceMindmapBody;
}

/**
 * Root children become chapters. Their children become sections. Deeper nodes
 * are written into the section body. Linked chapters that already have videos,
 * problems, homework, a problem set, a collect, or the course-exam gate stay.
 * A node that changes level or parent stays where it already is.
 */
export function applyMindmapToChapters(input: {
    dag: TrainingNode[];
    nodes: MindmapChapterSourceNode[];
    rootNodeId: string;
    protectedChapterIds?: ReadonlySet<number>;
}): MindmapChapterApplyResult {
    const protectedIds = input.protectedChapterIds || new Set<number>();
    const { root, byId } = buildTree(input.nodes, input.rootNodeId);
    if (!root.children.length) throw new CourseChapterGenerateError('empty');
    const chapterBySource = new Map<string, TrainingNode>();
    const sectionBySource = new Map<string, StoredSection>();
    const seenChapterIds = new Set<number>();
    for (const chapter of input.dag) {
        if (!Number.isSafeInteger(chapter._id) || chapter._id < 1 || seenChapterIds.has(chapter._id)) {
            throw new CourseChapterGenerateError('broken');
        }
        seenChapterIds.add(chapter._id);
        if (chapter.sourceMindmapNodeId) {
            if (
                !NODE_ID.test(chapter.sourceMindmapNodeId) ||
                chapterBySource.has(chapter.sourceMindmapNodeId) ||
                sectionBySource.has(chapter.sourceMindmapNodeId)
            ) {
                throw new CourseChapterGenerateError('duplicate');
            }
            chapterBySource.set(chapter.sourceMindmapNodeId, chapter);
        }
        const seenSectionIds = new Set<number>();
        for (const section of chapter.sections || []) {
            if (!Number.isSafeInteger(section._id) || section._id < 1 || seenSectionIds.has(section._id)) {
                throw new CourseChapterGenerateError('broken');
            }
            seenSectionIds.add(section._id);
            if (!section.sourceMindmapNodeId) continue;
            if (
                !NODE_ID.test(section.sourceMindmapNodeId) ||
                chapterBySource.has(section.sourceMindmapNodeId) ||
                sectionBySource.has(section.sourceMindmapNodeId)
            ) {
                throw new CourseChapterGenerateError('duplicate');
            }
            sectionBySource.set(section.sourceMindmapNodeId, { chapter, section });
        }
    }

    let nextChapterId = input.dag.reduce((max, chapter) => Math.max(max, chapter._id), 0);
    const allocChapterId = () => {
        nextChapterId += 1;
        if (!Number.isSafeInteger(nextChapterId)) throw new CourseChapterGenerateError('broken');
        return nextChapterId;
    };
    let createdChapters = 0;
    let createdSections = 0;
    let removedChapters = 0;
    let removedSections = 0;
    let contentSkipped = 0;
    let keptRemoved = 0;
    let keptProtected = 0;
    let displaced = 0;
    const placedChapterIds = new Set<number>();
    const generated: TrainingNode[] = [];
    const displacedSectionIds = new Set<string>();

    for (const [sourceId] of chapterBySource) {
        const node = byId.get(sourceId);
        if (node && node.parentId !== root.id) displaced += 1;
    }
    for (const [sourceId, stored] of sectionBySource) {
        const node = byId.get(sourceId);
        if (!node) continue;
        const chapterNodeId = stored.chapter.sourceMindmapNodeId;
        const chapterNode = chapterNodeId ? byId.get(chapterNodeId) : undefined;
        if (!chapterNode || chapterNode.parentId !== root.id) continue;
        if (node.parentId !== chapterNodeId) displaced += 1;
    }

    const sectionRole = (node: TreeNode, chapterNodeId: string) => {
        const stored = sectionBySource.get(node.id);
        if (chapterBySource.has(node.id)) return 'displaced' as const;
        if (!stored) return 'new' as const;
        if (stored.chapter.sourceMindmapNodeId !== chapterNodeId || node.parentId !== chapterNodeId) return 'displaced' as const;
        return 'matched' as const;
    };

    for (const chapterNode of root.children) {
        const storedChapter = chapterBySource.get(chapterNode.id);
        if (sectionBySource.has(chapterNode.id)) continue;
        const creating = !storedChapter;
        const chapter = storedChapter
            ? cloneChapter(storedChapter)
            : {
                  _id: allocChapterId(),
                  title: chapterNode.topic,
                  requireNids: [],
                  pids: [],
              };
        if (creating) createdChapters += 1;
        chapter.title = chapterNode.topic;
        chapter.sourceMindmapNodeId = chapterNode.id;
        const chapterBody = applyBody(storedChapter?.content, storedChapter?.sourceMindmapBody, generatedBody(chapterNode.description, []));
        if (chapterBody.skipped) contentSkipped += 1;
        writeBody(chapter, chapterBody);
        const usedSectionIds = new Set<number>((storedChapter?.sections || []).map((section) => section._id));
        const allocSectionId = () => {
            let id = usedSectionIds.size ? Math.max(...usedSectionIds) : 0;
            id += 1;
            if (!Number.isSafeInteger(id)) throw new CourseChapterGenerateError('broken');
            usedSectionIds.add(id);
            return id;
        };
        const matchedSections: TrainingSection[] = [];
        for (const sectionNode of chapterNode.children) {
            const role = sectionRole(sectionNode, chapterNode.id);
            if (role === 'displaced') {
                displacedSectionIds.add(sectionNode.id);
                continue;
            }
            const stored = role === 'matched' ? sectionBySource.get(sectionNode.id)?.section : undefined;
            const section: TrainingSection = stored
                ? cloneSection(stored)
                : {
                      _id: allocSectionId(),
                      title: sectionNode.topic,
                      pids: [],
                  };
            if (!stored) createdSections += 1;
            section.title = sectionNode.topic;
            section.sourceMindmapNodeId = sectionNode.id;
            const sectionBody = applyBody(stored?.content, stored?.sourceMindmapBody, generatedBody(sectionNode.description, sectionNode.children));
            if (sectionBody.skipped) contentSkipped += 1;
            writeBody(section, sectionBody);
            matchedSections.push(section);
        }
        const matchedIds = new Set(matchedSections.map((section) => section.sourceMindmapNodeId));
        const keptSections: TrainingSection[] = [];
        for (const section of storedChapter?.sections || []) {
            if (section.sourceMindmapNodeId && matchedIds.has(section.sourceMindmapNodeId)) continue;
            const stillInMap = section.sourceMindmapNodeId ? input.nodes.some((node) => node.id === section.sourceMindmapNodeId) : false;
            if (section.sourceMindmapNodeId && !stillInMap && !sectionHasTeacherContent(section)) {
                removedSections += 1;
                continue;
            }
            if (section.sourceMindmapNodeId && !stillInMap) keptRemoved += 1;
            keptSections.push(cloneSection(section));
        }
        const sections = [...matchedSections, ...keptSections];
        if (sections.length) chapter.sections = sections;
        else delete chapter.sections;
        generated.push(chapter);
        placedChapterIds.add(chapter._id);
    }

    const kept: TrainingNode[] = [];
    for (const chapter of input.dag) {
        if (placedChapterIds.has(chapter._id)) continue;
        const sourceId = chapter.sourceMindmapNodeId;
        const nodeStillExists = sourceId ? input.nodes.some((node) => node.id === sourceId) : false;
        if (!sourceId) {
            kept.push(cloneChapter(chapter));
            continue;
        }
        if (nodeStillExists) {
            kept.push(cloneChapter(chapter));
            continue;
        }
        const keptOwnSections = (chapter.sections || []).filter((section) => {
            if (!section.sourceMindmapNodeId) return true;
            if (displacedSectionIds.has(section.sourceMindmapNodeId)) return true;
            if (input.nodes.some((node) => node.id === section.sourceMindmapNodeId)) return true;
            if (sectionHasTeacherContent(section)) {
                keptRemoved += 1;
                return true;
            }
            removedSections += 1;
            return false;
        });
        const protectedChapter = protectedIds.has(chapter._id);
        const contentKept = chapterHasTeacherContent(chapter) || keptOwnSections.length > 0;
        if (!protectedChapter && !contentKept) {
            removedChapters += 1;
            continue;
        }
        if (protectedChapter) keptProtected += 1;
        else keptRemoved += 1;
        const next = cloneChapter(chapter);
        if (keptOwnSections.length) next.sections = keptOwnSections.map(cloneSection);
        else delete next.sections;
        kept.push(next);
    }

    let dag = [...generated, ...kept];
    const sole = input.dag.length === 1 ? input.dag[0] : undefined;
    if (sole && isPlaceholderChapter(sole) && !protectedIds.has(sole._id) && dag.some((chapter) => chapter._id !== sole._id)) {
        dag = dag.filter((chapter) => chapter._id !== sole._id);
    }
    if (!dag.length) throw new CourseChapterGenerateError('broken');
    const handKept = dag.some((chapter) => !chapter.sourceMindmapNodeId);
    const notices: string[] = [];
    if (contentSkipped) notices.push(`有 ${contentSkipped} 处正文已经改过，没有用导图说明覆盖。`);
    if (keptRemoved) notices.push(`有 ${keptRemoved} 个已有内容的章节或小节在导图里已删除，课程里仍保留。`);
    if (keptProtected) notices.push(`有 ${keptProtected} 个章节被结业考试或文件收集使用，课程里仍保留。`);
    if (displaced) notices.push(`有 ${displaced} 个节点在导图里换了层级或换到别的章，课程里仍留在原处。`);
    if (handKept) notices.push('手写章节留在后面。');
    return {
        dag,
        createdChapters,
        createdSections,
        removedChapters,
        removedSections,
        notices,
    };
}
