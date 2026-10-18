import type { FileInfo } from '@hydrooj/common/types';
import { FileLimitExceededError } from '../error';
import type { TrainingNode } from '../interface';

export function isPptxFilename(filename: string): boolean {
    return filename.toLowerCase().endsWith('.pptx');
}

export function chapterFileStoragePath(domainId: string, courseId: string, chapterId: number, filename: string): string {
    return `course/${domainId}/${courseId}/chapter/${chapterId}/${filename}`;
}

export function courseFileUsage(files: readonly FileInfo[] | undefined, dag: readonly TrainingNode[] | undefined): { count: number; size: number } {
    const chapterFiles = (dag || []).flatMap((node) => node.files || []);
    const all = [...(files || []), ...chapterFiles];
    return {
        count: all.length,
        size: all.reduce((sum, file) => sum + (file.size || 0), 0),
    };
}

export function assertCourseFileRoom(
    files: readonly FileInfo[] | undefined,
    dag: readonly TrainingNode[] | undefined,
    incoming: { size: number; replacing: boolean; replacedSize: number },
    limits: { count: number; size: number },
): void {
    const usage = courseFileUsage(files, dag);
    const count = usage.count + (incoming.replacing ? 0 : 1);
    const size = usage.size - incoming.replacedSize + incoming.size;
    if (count > limits.count) throw new FileLimitExceededError('count');
    if (size >= limits.size) throw new FileLimitExceededError('size');
}

/** Chapter saves do not carry file bytes. Keep the files already stored on a chapter that remains. */
export function reconcileChapterFiles(parsed: TrainingNode[], previous: readonly TrainingNode[]): TrainingNode[] {
    const previousById = new Map(previous.map((node) => [node._id, node]));
    return parsed.map((chapter) => {
        const files = previousById.get(chapter._id)?.files;
        if (!files?.length) {
            const next = { ...chapter };
            delete next.files;
            return next;
        }
        return { ...chapter, files };
    });
}

export function removedChapterFilePaths(
    domainId: string,
    courseId: string,
    previous: readonly TrainingNode[],
    next: readonly TrainingNode[],
): string[] {
    const surviving = new Set(next.map((node) => node._id));
    const paths: string[] = [];
    for (const node of previous) {
        if (surviving.has(node._id)) continue;
        for (const file of node.files || []) {
            paths.push(chapterFileStoragePath(domainId, courseId, node._id, file.name));
        }
    }
    return paths;
}

export function chapterFileCount(dag: readonly TrainingNode[] | undefined): number {
    return (dag || []).reduce((sum, node) => sum + (node.files?.length || 0), 0);
}
