import { expect } from 'chai';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const { recordingBelongsToStudent } = createRequire(import.meta.url)('../../ui-next/src/lib/vigil-api.ts');

describe('P4.6 Vigil recording deletion contracts', () => {
    it('gates both OJ proxy routes and records successful and failed operations', () => {
        const handler = read('packages/hydrooj/src/handler/vigil-integration.ts');

        expect(handler).to.include("ctx.Route('admin_vigil_recordings_delete_preview'");
        expect(handler).to.include("ctx.Route('admin_vigil_recordings_delete'");
        expect(handler).to.match(/recordings\/delete-preview[^\n]+PRIV\.PRIV_EDIT_SYSTEM/);
        expect(handler).to.match(/recordings\/delete'[^\n]+PRIV\.PRIV_EDIT_SYSTEM/);
        expect(handler).to.include("'vigil.recordings.delete'");
        expect(handler).to.include("'vigil.recordings.delete_failed'");
    });

    it('performs the OJ title confirmation and delegates a second confirmation to Vigil', () => {
        const handler = read('packages/hydrooj/src/handler/vigil-integration.ts');
        const section = handler.slice(
            handler.indexOf('class VigilRecordingDeletePreviewHandler'),
            handler.indexOf('class VigilAdminExamDetailHandler'),
        );

        expect(section).to.include('preview.contestTitle !== contest.title');
        expect(section).to.include('confirmTitle !== contest.title');
        expect(section).to.include('executeRecordingDelete(');
        expect(section).to.include('confirmTitle,');
    });

    it('disables automatic retries for one-time deletion intents', () => {
        const bridge = read('packages/hydrooj/src/service/vigil-bridge.ts');
        const section = bridge.slice(bridge.indexOf('export interface RecordingDeleteScope'));

        expect(section).to.match(/delete-preview[\s\S]*retries: 1/);
        expect(section).to.match(/recordings\/delete`[\s\S]*retries: 1/);
    });

    it('exposes contest, student, and file controls without bypassing the preview dialog', () => {
        const page = read('packages/ui-next/src/pages/vigil/index.tsx');
        const playback = read('packages/ui-next/src/pages/vigil/recording-playback-dialog.tsx');
        const dialog = read('packages/ui-next/src/pages/vigil/recording-delete-dialog.tsx');

        expect(page).to.include('删除整场录像');
        expect(page).to.include('删该生');
        expect(page).to.include('删本段');
        expect(playback).to.include('删除当前录像分段');
        expect(page).to.include('<RecordingDeleteDialog');
        expect(playback).to.include('<RecordingDeleteDialog');
        expect(dialog).to.include('previewRecordingDelete(scope)');
        expect(dialog).to.include('confirmation === preview?.contestTitle');
    });

    it('does not mix recordings when a machine changes students', () => {
        const baseRecording = {
            recordingId: 'recording-a',
            machineId: 'shared-machine',
            streamType: 'screen',
            filename: 'a.mp4',
            url: '/a.mp4',
            size: 1,
            durationMs: 1,
            startTs: '2026-07-13T00:00:00Z',
            endTs: '2026-07-13T00:00:01Z',
        };

        expect(recordingBelongsToStudent({ ...baseRecording, uid: 100 }, {
            machineId: 'shared-machine', examSessionId: 'session-b', uid: 200, name: 'B', status: 'online', eventCount: 0,
        })).to.equal(false);
        expect(recordingBelongsToStudent({ ...baseRecording, uid: 200 }, {
            machineId: 'other-machine', examSessionId: 'session-b', uid: 200, name: 'B', status: 'online', eventCount: 0,
        })).to.equal(true);
        expect(recordingBelongsToStudent({ ...baseRecording, examSessionId: 'unknown-a' }, {
            machineId: 'shared-machine', examSessionId: 'unknown-b', name: 'unknown', status: 'online', eventCount: 0,
        })).to.equal(false);
    });
});
