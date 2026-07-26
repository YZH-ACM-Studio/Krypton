import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { BootstrapProvider, getBootstrapFromWindow, type KryptonBootstrap, useBootstrap } from '../src/lib/bootstrap.tsx';

const makeBootstrap = (overrides: Partial<KryptonBootstrap> = {}): KryptonBootstrap => ({
  appName: 'Krypton',
  siteName: 'Krypton OJ',
  locale: 'zh_CN',
  theme: 'light',
  generatedAt: '2026-07-26T00:00:00.000Z',
  user: { id: 2, name: 'root', signedIn: true } as KryptonBootstrap['user'],
  domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
  urls: { home: '/' } as KryptonBootstrap['urls'],
  udict: {},
  page: { templateName: 'problem_main.html', data: {} },
  ...overrides,
});

describe('krypton bootstrap access', () => {
  afterEach(() => {
    delete window.__KRYPTON_BOOTSTRAP__;
  });

  it('throws when the window payload is absent', () => {
    expect(() => getBootstrapFromWindow()).to.throw('window.__KRYPTON_BOOTSTRAP__ is not available.');
  });

  it('returns the exact window payload without cloning', () => {
    const bootstrap = makeBootstrap();
    window.__KRYPTON_BOOTSTRAP__ = bootstrap;
    expect(getBootstrapFromWindow()).to.equal(bootstrap);
    expect(bootstrap.page).to.deep.equal({ templateName: 'problem_main.html', data: {} });
  });

  it('backfills a default page for stale payloads in place', () => {
    const bootstrap = makeBootstrap();
    delete (bootstrap as { page?: unknown }).page;
    window.__KRYPTON_BOOTSTRAP__ = bootstrap;
    const result = getBootstrapFromWindow();
    expect(result).to.equal(bootstrap);
    expect(result.page).to.deep.equal({ templateName: 'main.html', data: {} });
  });

  it('keeps an existing page untouched instead of overwriting it', () => {
    const bootstrap = makeBootstrap({ page: { templateName: 'contest_detail.html', data: { tid: 'abc' } } });
    window.__KRYPTON_BOOTSTRAP__ = bootstrap;
    expect(getBootstrapFromWindow().page).to.deep.equal({ templateName: 'contest_detail.html', data: { tid: 'abc' } });
  });

  it('useBootstrap yields the provider value by reference', () => {
    const bootstrap = makeBootstrap({ siteName: '中国民航大学 OJ' });
    let captured: KryptonBootstrap | null = null;
    function Capture() {
      captured = useBootstrap();
      return createElement('span', null, captured.siteName);
    }
    const markup = renderToStaticMarkup(createElement(BootstrapProvider, { bootstrap }, createElement(Capture)));
    expect(markup).to.include('中国民航大学 OJ');
    expect(captured).to.equal(bootstrap);
  });

  it('useBootstrap throws outside a provider', () => {
    function Orphan() {
      useBootstrap();
      return null;
    }
    expect(() => renderToStaticMarkup(createElement(Orphan))).to.throw('Krypton bootstrap data is missing.');
  });
});
