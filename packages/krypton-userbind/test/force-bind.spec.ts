import { expect } from 'chai';
import { describe, it } from 'node:test';
import {
    decideForceBind,
    isForceBindEnabled,
    pathIsForceBindAllowed,
    shouldForceBindSubject,
    wantsForceBindHtml,
    type ForceBindSubject,
} from '../src/force-bind';

function unboundStudent(overrides: Partial<ForceBindSubject> = {}): ForceBindSubject {
    return {
        uid: 2,
        role: 'default',
        isTemporary: false,
        hasEditSystem: false,
        bound: false,
        ...overrides,
    };
}

function decide(overrides: Partial<{
    enabled: boolean;
    subject: ForceBindSubject;
    path: string;
    method: string;
    wantsHtml: boolean;
}> = {}) {
    return decideForceBind({
        enabled: true,
        subject: unboundStudent(),
        path: '/p/1',
        method: 'GET',
        wantsHtml: true,
        ...overrides,
    });
}

describe('isForceBindEnabled', () => {
    it('enables true, 1, and unregistered values', () => {
        expect(isForceBindEnabled(true)).to.equal(true);
        expect(isForceBindEnabled(1)).to.equal(true);
        expect(isForceBindEnabled(undefined)).to.equal(true);
        expect(isForceBindEnabled(null)).to.equal(true);
        expect(isForceBindEnabled('')).to.equal(true);
    });

    it('treats false and 0 as off and rejects garbage', () => {
        expect(isForceBindEnabled(false)).to.equal(false);
        expect(isForceBindEnabled(0)).to.equal(false);
        expect(() => isForceBindEnabled('true')).to.throw(TypeError);
        expect(() => isForceBindEnabled(2)).to.throw(TypeError);
    });
});

describe('shouldForceBindSubject', () => {
    it('forces only a logged-in default-role unbound student', () => {
        expect(shouldForceBindSubject(unboundStudent())).to.equal(true);
        expect(shouldForceBindSubject(unboundStudent({ uid: 0 }))).to.equal(false);
        expect(shouldForceBindSubject(unboundStudent({ uid: -1 }))).to.equal(false);
    });

    it('exempts teacher, create_problems, and root even when unbound', () => {
        for (const role of ['teacher', 'create_problems', 'root']) {
            expect(shouldForceBindSubject(unboundStudent({ role })), role).to.equal(false);
            expect(decide({ subject: unboundStudent({ role }), path: '/p/1' }), role).to.equal('allow');
        }
    });

    it('exempts PRIV_EDIT_SYSTEM on a default unbound account', () => {
        const subject = unboundStudent({ hasEditSystem: true });
        expect(shouldForceBindSubject(subject)).to.equal(false);
        expect(decide({ subject, path: '/p/1' })).to.equal('allow');
    });

    it('exempts temporary accounts', () => {
        const subject = unboundStudent({ isTemporary: true });
        expect(shouldForceBindSubject(subject)).to.equal(false);
        expect(decide({ subject, path: '/p/1' })).to.equal('allow');
    });

    it('exempts already-bound default students', () => {
        const subject = unboundStudent({ bound: true });
        expect(shouldForceBindSubject(subject)).to.equal(false);
        expect(decide({ subject, path: '/p/1' })).to.equal('allow');
    });

    it('still forces when bound is false even if a profile studentId would exist', () => {
        expect(shouldForceBindSubject(unboundStudent({ bound: false }))).to.equal(true);
        expect(decide({ path: '/p/1', wantsHtml: true })).to.equal('redirect');
    });
});

describe('pathIsForceBindAllowed', () => {
    it('allows the exact homepage, bind, exam-shell, and collect-pending paths', () => {
        for (const path of ['/', '/userbind', '/exam-mode/x', '/api/collect/pending']) {
            expect(pathIsForceBindAllowed(path), path).to.equal(true);
            expect(decide({ path, wantsHtml: false }), path).to.equal('allow');
        }
        expect(pathIsForceBindAllowed('')).to.equal(true);
        expect(pathIsForceBindAllowed('/home')).to.equal(true);
        expect(pathIsForceBindAllowed('/favicon.ico')).to.equal(true);
        expect(pathIsForceBindAllowed('/manifest.json')).to.equal(true);
    });

    it('allows prefix paths only with an exact match or a following slash', () => {
        expect(pathIsForceBindAllowed('/bind/token')).to.equal(true);
        expect(pathIsForceBindAllowed('/binding')).to.equal(false);
        expect(pathIsForceBindAllowed('/userbind/applications')).to.equal(true);
        expect(pathIsForceBindAllowed('/login/2fa')).to.equal(true);
        expect(pathIsForceBindAllowed('/logout')).to.equal(true);
        expect(pathIsForceBindAllowed('/register')).to.equal(true);
        expect(pathIsForceBindAllowed('/lostpass/reset')).to.equal(true);
        expect(pathIsForceBindAllowed('/sudo')).to.equal(true);
        expect(pathIsForceBindAllowed('/oauth/github')).to.equal(true);
        expect(pathIsForceBindAllowed('/paper/42')).to.equal(true);
        expect(pathIsForceBindAllowed('/client-required-notice')).to.equal(true);
        expect(pathIsForceBindAllowed('/home/security')).to.equal(true);
        expect(pathIsForceBindAllowed('/home/security/sessions')).to.equal(true);
        expect(pathIsForceBindAllowed('/home/messages')).to.equal(true);
        expect(pathIsForceBindAllowed('/home/messages/inbox')).to.equal(true);
        expect(pathIsForceBindAllowed('/api/announce/unread')).to.equal(true);
        expect(pathIsForceBindAllowed('/api/announce/homepage')).to.equal(true);
        expect(pathIsForceBindAllowed('/home/settings')).to.equal(false);
    });

    it('does not treat /api as a prefix and keeps collect-pending exact-only', () => {
        expect(pathIsForceBindAllowed('/api')).to.equal(false);
        expect(pathIsForceBindAllowed('/api/record')).to.equal(false);
        expect(pathIsForceBindAllowed('/api/collect')).to.equal(false);
        expect(pathIsForceBindAllowed('/api/collect/pending/x')).to.equal(false);
        expect(pathIsForceBindAllowed('/api/collect/pending/')).to.equal(false);
        expect(decide({ path: '/api/record', wantsHtml: false })).to.equal('reject');
        expect(decide({ path: '/contest/1', wantsHtml: false })).to.equal('reject');
    });

    it('does not lowercase paths and ignores a query string', () => {
        expect(pathIsForceBindAllowed('/Userbind')).to.equal(false);
        expect(pathIsForceBindAllowed('/HOME')).to.equal(false);
        expect(pathIsForceBindAllowed('/userbind?next=/p/1')).to.equal(true);
        expect(pathIsForceBindAllowed('/p/1?tab=submit')).to.equal(false);
        expect(pathIsForceBindAllowed('?from=home')).to.equal(true);
    });
});

describe('decideForceBind', () => {
    it('allows every path when the switch is off', () => {
        expect(decide({ enabled: false, path: '/p/1', wantsHtml: true })).to.equal('allow');
        expect(decide({ enabled: false, path: '/p/1', method: 'POST', wantsHtml: false })).to.equal('allow');
        expect(decide({ enabled: false, path: '/contest/1', wantsHtml: false })).to.equal('allow');
        expect(decide({ enabled: false, path: '/api/record', wantsHtml: false })).to.equal('allow');
    });

    it('redirects HTML and rejects POST/JSON for an unbound default student on /p/1', () => {
        expect(decide({ path: '/p/1', method: 'GET', wantsHtml: true })).to.equal('redirect');
        expect(decide({ path: '/p/1', method: 'POST', wantsHtml: false })).to.equal('reject');
        expect(decide({ path: '/p/1', method: 'GET', wantsHtml: false })).to.equal('reject');
    });
});

describe('wantsForceBindHtml', () => {
    it('treats Hydro lowercase GET as HTML navigation', () => {
        expect(wantsForceBindHtml('get', 'text/html,application/xhtml+xml', false)).to.equal(true);
        expect(wantsForceBindHtml('GET', 'text/html', false)).to.equal(true);
        expect(wantsForceBindHtml('post', 'text/html', false)).to.equal(false);
        expect(wantsForceBindHtml('get', 'application/json', true)).to.equal(false);
        expect(wantsForceBindHtml('get', 'text/html', true)).to.equal(false);
    });
});
