import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect } from 'chai';
import { describe, it } from 'node:test';
import { presentLegacyUiError } from '../utils/error-presenter';

const canonicalError = {
  name: 'ValidationError',
  errorCode: 'ValidationError',
  code: 400,
  status: 400,
  params: ['content'],
  message: '字段 content 校验失败。',
};

describe('ui-default error presentation', () => {
  it('uses the authoritative AJAX message without translating or appending params', () => {
    const report = () => {
      throw new Error('valid envelopes must not be reported');
    };
    expect(
      presentLegacyUiError(
        { error: canonicalError },
        {
          fallback: '请求失败',
          createTraceId: () => 'ui-default-test-trace',
          report,
          status: 400,
        },
      ),
    ).to.equal('字段 content 校验失败。');
  });

  it('fails malformed AJAX envelopes closed with a trace ID', () => {
    let reported = false;
    expect(
      presentLegacyUiError(
        { error: { message: 'Field {0} failed', params: ['content'] } },
        {
          fallback: '请求失败',
          createTraceId: () => 'ui-default-test-trace',
          report: () => {
            reported = true;
          },
        },
      ),
    ).to.equal('请求失败：服务器返回了无法解析的错误响应。错误编号：ui-default-test-trace');
    expect(reported).to.equal(true);
  });

  it('keeps the server-rendered error page on the authoritative message path only', () => {
    const template = readFileSync(resolve(process.cwd(), 'packages/ui-default/templates/error.html'), 'utf8');
    expect(template).to.include('{{ error.message }}');
    expect(template).not.to.include('formatFromArray');
    expect(template).not.to.match(/for param in error\.params/);
  });

  it('removes legacy success-body error branches and upload message wrapping', () => {
    const legacyBranches = [
      'packages/ui-default/utils/index.ts',
      'packages/ui-default/pages/manage_user_import.page.js',
      'packages/ui-default/pages/contest_manage.page.ts',
      'packages/ui-default/pages/problem_files.page.tsx',
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
      .join('\n');
    const upload = readFileSync(resolve(process.cwd(), 'packages/ui-default/components/upload.tsx'), 'utf8');
    const directErrorConsumers = [
      'packages/ui-default/components/monaco/index.ts',
      'packages/ui-default/components/preview/preview.page.ts',
      'packages/ui-default/components/vote/vote.page.js',
    ]
      .map((path) => readFileSync(resolve(process.cwd(), path), 'utf8'))
      .join('\n');

    expect(legacyBranches).not.to.match(/\bres\.error\b/);
    expect(upload).not.to.include("i18n('File upload failed: {0}'");
    expect(upload).not.to.match(/\be\.toString\(\)/);
    expect(directErrorConsumers).not.to.match(/i18n\('(?:Failed to load file|Failed to vote): \{0\}'/);
    expect(directErrorConsumers).not.to.match(/i18n\('Upload Failed'\).*e\.message/);
  });

  it('keeps the authoritative setting-save message in the notification title', () => {
    const settings = readFileSync(resolve(process.cwd(), 'packages/ui-default/pages/setting.page.tsx'), 'utf8');

    expect(settings).to.include('Notification.error(e.message)');
    expect(settings).not.to.match(/Notification\.error\([^,\n]+,\s*e\.message\)/);
  });

  it('does not expose native fetch errors from the ZIP downloader', () => {
    const downloader = readFileSync(resolve(process.cwd(), 'packages/ui-default/components/zipDownloader/index.ts'), 'utf8');

    expect(downloader).to.include('class DownloadHttpError extends Error');
    expect(downloader).to.include("e instanceof DownloadHttpError ? e.message : i18n('Network error')");
    expect(downloader).not.to.include('e instanceof Error ? e.message : String(e)');
  });
});
