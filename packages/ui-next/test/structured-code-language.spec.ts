import { LanguageSupport } from '@codemirror/language';
import { describe, expect, it } from 'vitest';
import { structuredCodeLanguageExtension } from '../src/lib/structured-code-language';

function languageName(lang: string): string {
  const extension = structuredCodeLanguageExtension(lang);
  expect(extension).to.be.instanceOf(LanguageSupport);
  return (extension as LanguageSupport).language.name;
}

describe('structuredCodeLanguageExtension', () => {
  it('maps c-family aliases to the cpp language', () => {
    expect(languageName('c')).to.equal('cpp');
    expect(languageName('cc')).to.equal('cpp');
    expect(languageName('cpp')).to.equal('cpp');
  });

  it('maps python aliases to the python language', () => {
    expect(languageName('py')).to.equal('python');
    expect(languageName('python')).to.equal('python');
  });

  it('maps java, go, and rust', () => {
    expect(languageName('java')).to.equal('java');
    expect(languageName('go')).to.equal('go');
    expect(languageName('rs')).to.equal('rust');
    expect(languageName('rust')).to.equal('rust');
  });

  it('distinguishes the typescript dialect from plain javascript', () => {
    expect(languageName('js')).to.equal('javascript');
    expect(languageName('javascript')).to.equal('javascript');
    expect(languageName('ts')).to.equal('typescript');
    expect(languageName('typescript')).to.equal('typescript');
  });

  it('is case-insensitive', () => {
    expect(languageName('CPP')).to.equal('cpp');
    expect(languageName('Python')).to.equal('python');
    expect(languageName('TS')).to.equal('typescript');
  });

  it('uses only the segment before the first dot (hydro language keys)', () => {
    expect(languageName('cc.cc14o2')).to.equal('cpp');
    expect(languageName('py.py3')).to.equal('python');
    expect(languageName('rs.rs2021')).to.equal('rust');
  });

  it('returns an empty extension for unknown or empty languages', () => {
    expect(structuredCodeLanguageExtension('pas')).to.deep.equal([]);
    expect(structuredCodeLanguageExtension('haskell')).to.deep.equal([]);
    expect(structuredCodeLanguageExtension('')).to.deep.equal([]);
    expect(structuredCodeLanguageExtension('.cpp')).to.deep.equal([]);
  });
});
