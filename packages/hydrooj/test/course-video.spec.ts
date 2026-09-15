import { expect } from 'chai';
import { describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseCourseSections } from '../src/lib/course-chapter';
import type { CourseVideo } from '../src/interface';
import {
    applyCourseVideoHeartbeat,
    assertCanRemoveChapter,
    COURSE_VIDEO_MAX_BYTES,
    COURSE_VIDEO_MAX_PER_NODE,
    courseVideoStoragePath,
    courseUnitProgress,
    isCourseVideoComplete,
    mergeCoverageRanges,
    parseCourseVideos,
    parseRequireRewatch,
    reconcileCourseDagVideos,
    rewriteCourseVideosForCopy,
    studentVisibleVideos,
} from '../src/lib/course-video';
import { csvCell, csvTable } from '../src/lib/course-video-csv';

function readSrc(relative: string) {
    return readFileSync(resolve(__dirname, '..', relative), 'utf8');
}

function video(partial: Partial<CourseVideo> = {}): CourseVideo {
    return {
        id: 'cv_abcdefghijklmnopqr1',
        title: '消防一',
        filename: 'fire.mp4',
        ext: 'mp4',
        size: 1024,
        sha256: 'a'.repeat(64),
        durationMs: 0,
        confirmed: false,
        contentRevision: 1,
        ...partial,
    };
}

describe('course video schema', () => {
    it('parses exact-key videos and rejects extras, bad ext, and oversized files', () => {
        const parsed = parseCourseVideos('章节 1', [video()]);
        expect(parsed).to.have.length(1);
        expect(() => parseCourseVideos('章节 1', [{ ...video(), order: 1 }])).to.throw(/未知字段 order/);
        expect(() => parseCourseVideos('章节 1', [{ ...video(), ext: 'mkv' }])).to.throw(/扩展名无效/);
        expect(() => parseCourseVideos('章节 1', [{ ...video(), size: COURSE_VIDEO_MAX_BYTES + 1 }])).to.throw(/大小无效/);
        expect(() => parseCourseVideos('章节 1', Array.from({ length: COURSE_VIDEO_MAX_PER_NODE + 1 }, (_, i) => video({ id: `cv_${'abcdefghijklmnopqrs'.slice(0, 20)}${i}` })))).to.throw(/最多 8/);
        expect(() => parseCourseVideos('章节 1', [{ ...video(), confirmed: true, durationMs: 0 }])).to.throw(/时长超出范围/);
        expect(() => parseCourseVideos('章节 1', [{ ...video(), confirmed: false, durationMs: 4000 }])).to.throw(/未确认视频的时长必须为 0/);
    });

    it('parses section videos and still rejects unknown section keys', () => {
        const sections = parseCourseSections(3, [{ _id: 1, title: '引入', pids: [11], videos: [video()] }], (value) => (value as number[]).map(Number));
        expect(sections[0].videos?.[0].id).to.equal('cv_abcdefghijklmnopqr1');
        expect(() => parseCourseSections(3, [{ _id: 1, title: 'A', pids: [11], order: 1 }], () => [])).to.throw(/未知字段 order/);
    });

    it('hides unconfirmed videos from students', () => {
        expect(studentVisibleVideos([video(), video({ id: 'cv_abcdefghijklmnopqr2', confirmed: true, durationMs: 4000 })])).to.have.length(1);
    });

    it('builds a path that cannot escape the course prefix', () => {
        expect(courseVideoStoragePath('system', '66b700000000000000000010', 'cv_abcdefghijklmnopqr1', 2, 'webm')).to.equal(
            'course/system/66b700000000000000000010/video/cv_abcdefghijklmnopqr1/r2.webm',
        );
        expect(() => courseVideoStoragePath('system/../x', 'tid', 'cv_abcdefghijklmnopqr1', 1, 'mp4')).to.throw(/invalid domainId/);
    });
});

describe('course unit progress', () => {
    it('counts videos and problems together and is 100 only when both are empty', () => {
        expect(courseUnitProgress(0, 1, 0, 0)).to.deep.equal({ doneCount: 0, totalCount: 1, progress: 0 });
        expect(courseUnitProgress(1, 1, 2, 2)).to.deep.equal({ doneCount: 3, totalCount: 3, progress: 100 });
        expect(courseUnitProgress(0, 0, 0, 0)).to.deep.equal({ doneCount: 0, totalCount: 0, progress: 100 });
    });
});

describe('course video coverage', () => {
    it('merges overlapping ranges and completes at 95% or last-3s slack', () => {
        expect(mergeCoverageRanges([[1, 2], [1.5, 3], [10, 11]])).to.deep.equal([[1, 3], [10, 11]]);
        expect(isCourseVideoComplete([[0, 95]], 100_000)).to.equal(true);
        expect(isCourseVideoComplete([[0, 94]], 100_000)).to.equal(false);
        expect(isCourseVideoComplete([[0, 98]], 100_000)).to.equal(true);
        expect(isCourseVideoComplete([[0, 8]], 10_000)).to.equal(true);
    });

    it('accepts rewind coverage and rejects forward jumps, hidden, and overspeed', () => {
        const duration = 120_000;
        const playing = applyCourseVideoHeartbeat(
            { ranges: [], maxRate: 1, seekForwardAttempts: 0, lastPosition: 0 },
            { covered: [0, 5], position: 5, playbackRate: 1, seekForwardAttempts: 0, visible: true },
            duration,
        );
        expect(playing.rejectedReason).to.equal(null);
        expect(playing.lastPosition).to.equal(5);
        const rewind = applyCourseVideoHeartbeat(playing, { covered: [1, 3], position: 3, playbackRate: 1, seekForwardAttempts: 0, visible: true }, duration);
        expect(rewind.rejectedReason).to.equal(null);
        expect(rewind.ranges[0]).to.deep.equal([0, 5]);
        const seek = applyCourseVideoHeartbeat(playing, { covered: [40, 45], position: 45, playbackRate: 1, seekForwardAttempts: 1, visible: true }, duration);
        expect(seek.rejectedReason).to.equal('seek');
        expect(seek.seekForwardAttempts).to.be.greaterThan(playing.seekForwardAttempts);
        expect(seek.ranges).to.deep.equal(playing.ranges);
        const hidden = applyCourseVideoHeartbeat(playing, { covered: [5, 10], position: 10, playbackRate: 1, seekForwardAttempts: 0, visible: false }, duration);
        expect(hidden.rejectedReason).to.equal('hidden');
        const fast = applyCourseVideoHeartbeat(playing, { covered: [5, 10], position: 10, playbackRate: 2, seekForwardAttempts: 0, visible: true }, duration);
        expect(fast.rejectedReason).to.equal('rate');
    });
});

describe('course video mutations', () => {
    it('requires an explicit rewatch flag', () => {
        expect(parseRequireRewatch(true)).to.equal(true);
        expect(parseRequireRewatch('false')).to.equal(false);
        expect(() => parseRequireRewatch(undefined)).to.throw(/必须明确/);
        expect(() => parseRequireRewatch('maybe')).to.throw(/必须明确/);
    });

    it('blocks deleting a chapter or section that still has videos', () => {
        expect(() => assertCanRemoveChapter({ _id: 1, videos: [video() as any], sections: [] })).to.throw(/还有视频/);
        expect(() =>
            assertCanRemoveChapter({ _id: 1, videos: [], sections: [{ _id: 2, title: 's', pids: [], videos: [video() as any] }] }),
        ).to.throw(/小节 2 还有视频/);
    });

    it('keeps persisted videos when chapter save omits them and rejects id changes', () => {
        const previous = [{ _id: 1, title: 'A', requireNids: [], pids: [], videos: [video({ confirmed: true, durationMs: 4000 })] as any }];
        const kept = reconcileCourseDagVideos([{ _id: 1, title: 'A', requireNids: [], pids: [] }], previous);
        expect(kept[0].videos?.[0].id).to.equal('cv_abcdefghijklmnopqr1');
        expect(() =>
            reconcileCourseDagVideos(
                [{ _id: 1, title: 'A', requireNids: [], pids: [], videos: [video({ id: 'cv_abcdefghijklmnopqr2' }) as any] }],
                previous,
            ),
        ).to.throw(/不能通过保存章节增删视频/);
        expect(() => reconcileCourseDagVideos([], previous)).to.throw(/还有视频/);
        expect(() =>
            reconcileCourseDagVideos([{ _id: 2, title: 'B', requireNids: [], pids: [], videos: [video()] }], []),
        ).to.throw(/不能通过保存章节新增视频/);
    });

    it('rewrites video ids on copy and resets revision to 1', () => {
        const source = [
            {
                _id: 1,
                title: 'A',
                requireNids: [],
                pids: [],
                videos: [video({ contentRevision: 4, confirmed: true, durationMs: 4000 }) as any],
                sections: [{ _id: 2, title: 's', pids: [], videos: [video({ id: 'cv_abcdefghijklmnopqr2', contentRevision: 2 }) as any] }],
            },
        ];
        let n = 0;
        const copied = rewriteCourseVideosForCopy(source, () => `cv_new${String(++n).padStart(18, '0')}`);
        expect(copied.copies).to.have.length(2);
        expect(copied.dag[0].videos?.[0].id).to.match(/^cv_new/);
        expect(copied.dag[0].videos?.[0].contentRevision).to.equal(1);
        expect(copied.dag[0].videos?.[0].id).to.not.equal('cv_abcdefghijklmnopqr1');
        expect(copied.dag[0].sections?.[0].videos?.[0].id).to.not.equal('cv_abcdefghijklmnopqr2');
    });
});

describe('course video csv', () => {
    it('neutralizes formula prefixes', () => {
        expect(csvCell('=1+1')).to.equal("'=1+1");
        expect(csvTable(['学号'], [['=cmd']])).to.match(/'=cmd/);
    });
});

describe('course video wiring', () => {
    it('registers dedicated video routes and does not use attachment downloads for playback', () => {
        const course = readSrc('src/handler/course.ts');
        const video = readSrc('src/handler/course-video.ts');
        expect(video).to.include("ctx.Route('course_video_upload'");
        expect(video).to.include("ctx.Route('course_video_play'");
        expect(video).to.include("ctx.Route('course_video_progress'");
        expect(video).to.include("ctx.Route('course_videos'");
        expect(video).to.include("ctx.Route('course_videos_csv'");
        expect(video).to.include("rosterUnavailable: 'no_groups'");
        expect(video).to.include('未指定班级，无法出观看名单');
        expect(video).to.include('requireRewatch');
        expect(video).to.include("@param('title', Types.String, true)");
        expect(course).to.include('courseVideoDueAt');
        expect(course).to.include('rewriteCourseVideosForCopy');
        expect(video).to.include('getRange');
        expect(video).not.to.match(/video\/:videoId\/play[\s\S]{0,800}signDownloadLink/);
        const postCopy = course.slice(course.indexOf('async postCopy('), course.indexOf('async postDelete('));
        expect(postCopy).to.include('rewriteCourseVideosForCopy');
        expect(postCopy).to.include('storage.copy');
    });
});
