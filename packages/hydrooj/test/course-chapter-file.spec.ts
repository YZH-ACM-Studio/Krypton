import { expect } from 'chai';
import { describe, it } from 'node:test';
import { FileLimitExceededError } from '../src/error';
import {
    assertCourseFileRoom,
    chapterFileStoragePath,
    courseFileUsage,
    isPptxFilename,
    reconcileChapterFiles,
    removedChapterFilePaths,
} from '../src/lib/course-chapter-file';
import type { FileInfo } from '@hydrooj/common/types';
import type { TrainingNode } from '../src/interface';

function file(name: string, size: number): FileInfo {
    return { _id: name, name, size, etag: 'etag', lastModified: new Date('2026-10-18T00:00:00.000Z') };
}

function chapter(id: number, files?: FileInfo[]): TrainingNode {
    return {
        _id: id,
        title: `第 ${id} 章`,
        requireNids: [],
        pids: [],
        ...(files ? { files } : {}),
    };
}

describe('course chapter files', () => {
    it('previews only pptx names', () => {
        expect(isPptxFilename('第一章.PPTX')).to.equal(true);
        expect(isPptxFilename('旧课件.ppt')).to.equal(false);
        expect(isPptxFilename('notes.pdf')).to.equal(false);
    });

    it('counts course files and chapter files together', () => {
        const usage = courseFileUsage(
            [file('总课件.pptx', 10)],
            [chapter(2, [file('概述.pptx', 20)]), chapter(3, [file('表达式.pdf', 30)])],
        );
        expect(usage).to.deep.equal({ count: 3, size: 60 });
    });

    it('rejects a file that would pass the shared count or size limit', () => {
        const limits = { count: 2, size: 100 };
        const files = [file('总课件.pptx', 40)];
        const dag = [chapter(2, [file('概述.pptx', 40)])];
        expect(() => assertCourseFileRoom(files, dag, { size: 10, replacing: false, replacedSize: 0 }, limits))
            .to.throw(FileLimitExceededError);
        expect(() => assertCourseFileRoom(files, dag, { size: 30, replacing: true, replacedSize: 40 }, limits))
            .to.not.throw();
        expect(() => assertCourseFileRoom(files, dag, { size: 60, replacing: true, replacedSize: 40 }, limits))
            .to.throw(FileLimitExceededError);
    });

    it('keeps stored chapter files across a chapter save and drops them when the chapter is removed', () => {
        const previous = [chapter(2, [file('概述.pptx', 20)]), chapter(3, [file('表达式.pptx', 30)])];
        const kept = reconcileChapterFiles([chapter(2), chapter(4)], previous);
        expect(kept.find((node) => node._id === 2)?.files?.map((item) => item.name)).to.deep.equal(['概述.pptx']);
        expect(kept.find((node) => node._id === 4)?.files).to.equal(undefined);
        expect(removedChapterFilePaths('system', 'course', previous, kept)).to.deep.equal([
            chapterFileStoragePath('system', 'course', 3, '表达式.pptx'),
        ]);
    });
});
