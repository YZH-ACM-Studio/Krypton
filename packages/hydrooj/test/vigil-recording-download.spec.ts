import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('P4.7 Vigil recording download contracts', () => {
    it('mints a short one-time credential without putting the dashboard token in a URL', () => {
        const api = read('packages/ui-next/src/lib/vigil-api.ts');
        const server = read('ecosystems/KryptonVigilSystem/Server/app/api/recording_downloads.py');

        expect(server).to.include('_DOWNLOAD_TOKEN_TTL_SECONDS = 60');
        expect(server).to.include('_download_tokens.pop(dl, None)');
        expect(server).to.include('"actorUid": request.actor.uid');
        expect(server).to.include('require_dashboard_header_token');
        expect(server).to.include('"Cache-Control": "private, no-store"');
        expect(api).to.include('requestRecordingDownload(');
        expect(api).to.match(/\?dl=\$\{encodeURIComponent\(token\.dl\)\}/);
        expect(api).not.to.match(/href=.*dashboardToken/);
        expect(api).not.to.match(/\?token=.*dashboard/);
    });

    it('keeps single and student downloads on the exact identity scopes', () => {
        const server = read('ecosystems/KryptonVigilSystem/Server/app/api/recording_downloads.py');

        expect(server).to.include('/recordings/{recording_id}/download');
        expect(server).to.include('/students/by-user/{oj_user_id}/recordings.zip');
        expect(server).to.include('/students/by-session/{exam_session_id}/recordings.zip');
        expect(server).to.include('Recording.oj_user_id == oj_user_id');
        expect(server).to.include('Recording.exam_session_id == exam_session_id');
        expect(server).to.include('Recording.oj_user_id == None');
    });

    it('streams uncompressed zip files and applies server-side filename safety', () => {
        const server = read('ecosystems/KryptonVigilSystem/Server/app/api/recording_downloads.py');

        expect(server).to.include('compression=ZIP_STORED');
        expect(server).to.include('StreamingResponse(');
        expect(server).to.include('source.read(1024 * 1024)');
        expect(server).to.include("filename*=UTF-8''");
        expect(server).to.include('120 - len(extension)');
        expect(server).to.include('raw_path.is_symlink()');
        expect(server).to.include('path.is_relative_to(root)');
    });

    it('exposes download controls in playback and student detail views', () => {
        const api = read('packages/ui-next/src/lib/vigil-api.ts');
        const playback = read('packages/ui-next/src/pages/vigil/recording-playback-dialog.tsx');
        const detail = read('packages/ui-next/src/pages/vigil/student-detail-sheet.tsx');

        expect(api).to.include("window.open('about:blank', '_blank')");
        expect(api).to.include('target.location.replace(url)');
        expect(playback).to.include('分段下载');
        expect(playback).to.include('chunks.map((chunk, index)');
        expect(playback).to.include('onDownload(chunk)');
        expect(playback).to.include('{ recordingId: recording.recordingId }');
        expect(detail).to.include('打包下载录像');
        expect(detail).to.include('{ ojUserId: student.uid }');
        expect(detail).to.include('{ examSessionId: student.examSessionId }');
    });
});
