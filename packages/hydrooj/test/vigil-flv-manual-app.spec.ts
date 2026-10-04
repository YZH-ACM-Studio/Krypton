import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { expect } from 'chai';

const STREAM = '6a45d9f8f923c49cc94da25a_m_fc2b1ee50b9daad427dd_screen';

function read(path: string): string {
    return readFileSync(resolve(process.cwd(), path), 'utf8');
}

/** Text of `class VigilCheckHlsAccessHandler` up to the next `class `. */
function vigilCheckHlsAccessSection(source: string): string {
    const start = source.indexOf('class VigilCheckHlsAccessHandler');
    if (start < 0) throw new Error('class VigilCheckHlsAccessHandler not found');
    const next = source.indexOf('class ', start + 'class '.length);
    return next < 0 ? source.slice(start) : source.slice(start, next);
}

/** Compile the regex literal on the `path.match(...)` line for `name`. */
function compilePathMatch(section: string, name: string): RegExp {
    const line = section.split('\n').find((item) => item.includes(`const ${name} = path.match(`));
    if (!line) throw new Error(`${name} line not found`);
    const literal = line.match(/path\.match\((\/(?:\\.|[^/])+\/[a-z]*)\)/);
    if (!literal || literal[1] === undefined) throw new Error(`${name} regex literal not found`);
    const parsed = /^\/([\s\S]*)\/([a-z]*)$/.exec(literal[1]);
    if (!parsed || parsed[1] === undefined) throw new Error(`${name} regex literal is not parseable`);
    return new RegExp(parsed[1], parsed[2] ?? '');
}

describe('VigilCheckHlsAccessHandler live-manual app', () => {
    const section = vigilCheckHlsAccessSection(read('packages/hydrooj/src/handler/vigil-integration.ts'));

    it('matches a live-manual FLV path', () => {
        const flv = compilePathMatch(section, 'flvMatch');
        expect(flv.test(`/vigil-flv/live-manual/${STREAM}.flv`)).to.equal(true);
    });

    it('matches live-record and live-nodvr FLV paths', () => {
        const flv = compilePathMatch(section, 'flvMatch');
        expect(flv.test(`/vigil-flv/live-record/${STREAM}.flv`)).to.equal(true);
        expect(flv.test(`/vigil-flv/live-nodvr/${STREAM}.flv`)).to.equal(true);
    });

    it('rejects a live-other FLV path', () => {
        const flv = compilePathMatch(section, 'flvMatch');
        expect(flv.test(`/vigil-flv/live-other/${STREAM}.flv`)).to.equal(false);
    });

    it('matches a live-manual HLS playlist path', () => {
        const live = compilePathMatch(section, 'liveMatch');
        expect(live.test(`/vigil-hls/live-manual/${STREAM}.m3u8`)).to.equal(true);
    });

    it('matches live-record and live-nodvr HLS playlist paths', () => {
        const live = compilePathMatch(section, 'liveMatch');
        expect(live.test(`/vigil-hls/live-record/${STREAM}.m3u8`)).to.equal(true);
        expect(live.test(`/vigil-hls/live-nodvr/${STREAM}.m3u8`)).to.equal(true);
    });

    it('rejects a live-other HLS playlist path', () => {
        const live = compilePathMatch(section, 'liveMatch');
        expect(live.test(`/vigil-hls/live-other/${STREAM}.m3u8`)).to.equal(false);
    });

    it('matches a live-manual camera FLV path', () => {
        const flv = compilePathMatch(section, 'flvMatch');
        const camera = STREAM.replace(/_screen$/, '_camera');
        expect(flv.test(`/vigil-flv/live-manual/${camera}.flv`)).to.equal(true);
    });
});
