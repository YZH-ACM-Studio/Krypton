import { expect } from 'chai';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';
import { formatDateTime, resolveUiLocale } from '../src/lib/format.ts';

describe('ui-next locale boundary', () => {
  it('maps every legacy Hydro language preference to the only supported UI locale', () => {
    expect(resolveUiLocale('zh_TW')).to.equal('zh-CN');
    expect(resolveUiLocale('en')).to.equal('zh-CN');
    expect(resolveUiLocale(undefined)).to.equal('zh-CN');
    expect(() => resolveUiLocale({ legacy: 'zh_TW' })).to.throw(TypeError);
    expect(() => resolveUiLocale(1)).to.throw(TypeError);
    expect(() => formatDateTime('2026-07-23T00:00:00.000Z', 'zh_TW')).not.to.throw();
  });

  it('normalizes the user preference before exposing bootstrap locale fields', () => {
    const source = readFileSync(resolve(process.cwd(), 'packages/ui-next/index.ts'), 'utf8');
    expect(source).to.include('const uiLocale = resolveUiLocale(currentUser.viewLang)');
    expect(source).to.include('locale: uiLocale');
    expect(source).to.include('viewLang: uiLocale');
    expect(source).not.to.include("locale: currentUser.viewLang || 'zh-CN'");
    expect(source).not.to.include("viewLang: currentUser.viewLang || 'zh-CN'");
  });
});
