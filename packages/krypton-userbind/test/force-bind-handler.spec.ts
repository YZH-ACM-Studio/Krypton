import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';

const handlerSource = readFileSync(resolve(__dirname, '../src/handler.ts'), 'utf8');
const indexSource = readFileSync(resolve(__dirname, '../index.ts'), 'utf8');
const forceBindSource = readFileSync(resolve(__dirname, '../src/force-bind.ts'), 'utf8');
const bindingSource = readFileSync(resolve(__dirname, '../src/binding.ts'), 'utf8');

function sliceBetween(text: string, startMarker: string, endMarker: string) {
    const start = text.indexOf(startMarker);
    const end = text.indexOf(endMarker, start + startMarker.length);
    expect(start, `missing ${startMarker}`).to.be.at.least(0);
    expect(end, `missing ${endMarker} after ${startMarker}`).to.be.greaterThan(start);
    return text.slice(start, end);
}

function quotedStringsInArray(source: string, name: string): string[] {
    const match = source.match(new RegExp(`${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`));
    expect(match, `missing ${name}`).to.not.equal(null);
    return [...(match?.[1].matchAll(/['"]([^'"]+)['"]/g) ?? [])].map((item) => item[1]);
}

function forceBindHookSource() {
    const start = handlerSource.lastIndexOf("ctx.on('handler/before-prepare'");
    expect(start, 'missing handler/before-prepare hook').to.be.at.least(0);
    return handlerSource.slice(start);
}

describe('force-bind handler source contracts', () => {
    const hook = forceBindHookSource();
    const userBindHandler = sliceBetween(handlerSource, 'class UserBindHandler extends Handler', 'class UserBindApplicationsHandler');
    const applicationsHandler = sliceBetween(
        handlerSource,
        'class UserBindApplicationsHandler extends Handler',
        'class BindLandingHandler',
    );

    it('short-circuits HTML redirects with cleanup and never returns true', () => {
        expect(hook).to.include("return 'cleanup'");
        expect(hook).to.not.match(/return true\s*;/);
        expect(handlerSource).to.not.match(/return true\s*;/);
        expect(handlerSource).to.not.include('shouldEnforceBindFor');
    });

    it('decides binding from findStudentByUserId and BindingRequiredError', () => {
        expect(handlerSource).to.include('findStudentByUserId');
        expect(hook).to.include('findStudentByUserId');
        expect(hook).to.include('BindingRequiredError');
        expect(hook).to.include('throw new BindingRequiredError()');
        expect(hook).to.include('isForceBindEnabled');
        expect(hook).to.include('shouldForceBindSubject');
        expect(hook).to.include('decideForceBind');
        expect(hook).to.include('wantsForceBindHtml');
        expect(hook).to.include('userIsTemporary');
        expect(handlerSource).to.include('_udoc?.isTemporary');
        expect(handlerSource).to.match(/function userIsTemporary[\s\S]*_udoc\?\.isTemporary === true/);
        expect(hook).to.include('forceBindRequired');
        expect(hook.indexOf('forceBindRequired')).to.be.lessThan(hook.indexOf('decideForceBind'));
    });

    it('binds or queues through bindByRosterOrQueue instead of always submitting a request', () => {
        expect(handlerSource).to.include('bindByRosterOrQueue');
        expect(userBindHandler).to.include('bindByRosterOrQueue');
        expect(userBindHandler).to.include("userbind.bind.roster_match");
        expect(userBindHandler).to.include('user_bind_success.html');
        expect(userBindHandler).to.not.include('submitBindingRequest');
    });

    it('does not treat user.studentId as the bound gate', () => {
        expect(handlerSource).to.not.include('if ((handler.user as any).studentId) return false');
        expect(hook).to.not.include('studentId');
        expect(userBindHandler).to.not.include('(this.user as any).studentId');
        expect(userBindHandler).to.not.include('this.user.studentId');
        expect(userBindHandler).to.not.include('handler.user.studentId');
        expect(applicationsHandler).to.not.include('(this.user as any).studentId');
        expect(applicationsHandler).to.not.include('this.user.studentId');
        expect(userBindHandler).to.include('currentCanonicalBinding');
        expect(applicationsHandler).to.include('currentCanonicalBinding');
        expect(handlerSource).to.match(/async function currentCanonicalBinding[\s\S]*findStudentByUserId/);
    });

    it('does not whitelist /api as a blanket force-bind prefix', () => {
        expect(handlerSource).to.not.include('FORCE_BIND_BYPASS_PREFIX');
        const prefixes = quotedStringsInArray(forceBindSource, 'PREFIX_ALLOWED_PATHS');
        expect(prefixes).to.not.include('/api');
        expect(prefixes.some((prefix) => prefix === '/api' || prefix.startsWith('/api/'))).to.equal(false);
        expect(forceBindSource).to.include("'/api/collect/pending'");
        expect(forceBindSource).to.include("'/api/announce/unread'");
        expect(forceBindSource).to.include("'/api/announce/homepage'");
        expect(forceBindSource).to.include("'/home/messages'");
    });

    it('consumes student invite tokens through bindMatchedStudent CAS', () => {
        const consume = sliceBetween(
            bindingSource,
            'export async function consumeStudentInviteToken',
            'export async function bindMatchedStudent',
        );
        expect(consume).to.include('bindMatchedStudent');
        expect(consume).to.not.include('existing?.studentId');
        expect(consume).to.not.include('studentsColl.updateOne');
    });
});

describe('force-bind setting registration source contracts', () => {
    it('registers userbind.forceBind as a boolean system setting defaulting to true', () => {
        expect(indexSource).to.include("ctx.inject(['setting']");
        expect(indexSource).to.include('SystemSetting');
        expect(indexSource).to.include("'userbind.forceBind'");
        expect(indexSource).to.include("Setting(\n                'setting_userbind',\n                'userbind.forceBind',\n                true,\n                'boolean'");
        expect(indexSource).to.match(/'userbind\.forceBind',\s*true,\s*'boolean'/);
    });
});
