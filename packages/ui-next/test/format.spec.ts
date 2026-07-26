// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  formatDateTime,
  formatPlainTextSummary,
  formatRelativeTime,
  formatShortDate,
  makeInitials,
  replaceRouteTokens,
  toDate,
} from '../src/lib/format.ts';

describe('toDate', () => {
  it('returns the same instance when given a Date', () => {
    const date = new Date('2026-07-23T08:30:00Z');
    expect(toDate(date)).to.equal(date);
  });

  it('parses ISO strings and epoch milliseconds', () => {
    expect(toDate('2026-07-23T08:30:00.000Z')?.getTime()).to.equal(Date.UTC(2026, 6, 23, 8, 30));
    expect(toDate(1_000)?.getTime()).to.equal(1_000);
  });

  it('returns null for nullish and empty input', () => {
    expect(toDate(null)).to.equal(null);
    expect(toDate(undefined)).to.equal(null);
    expect(toDate('')).to.equal(null);
  });

  it('treats epoch zero as missing because the guard is falsy-based', () => {
    // Current behavior: `if (!value)` rejects the numeric timestamp 0
    // (1970-01-01T00:00:00Z) even though it is a valid instant.
    expect(toDate(0)).to.equal(null);
  });

  it('returns null for unparseable strings', () => {
    expect(toDate('not a date')).to.equal(null);
    expect(toDate('2026-99-99')).to.equal(null);
  });

  it('passes an invalid Date instance through unchanged', () => {
    // Current behavior: the instanceof branch wins before the NaN check,
    // so an invalid Date is returned as-is instead of null.
    const invalid = new Date('nope');
    expect(toDate(invalid)).to.equal(invalid);
  });
});

describe('formatDateTime', () => {
  it('returns TBD for missing or unparseable values', () => {
    expect(formatDateTime(null, 'zh-CN')).to.equal('TBD');
    expect(formatDateTime(undefined, 'zh-CN')).to.equal('TBD');
    expect(formatDateTime('garbage', 'zh-CN')).to.equal('TBD');
  });

  it('formats with medium date and short time in the pinned zh-CN locale', () => {
    expect(formatDateTime('2026-07-23T08:30:00Z', 'zh-CN', 'UTC')).to.equal('2026年7月23日 08:30');
  });

  it('honors an explicit timeZone', () => {
    expect(formatDateTime('2026-07-23T08:30:00Z', 'zh-CN', 'Asia/Shanghai')).to.equal('2026年7月23日 16:30');
  });

  it('ignores the caller locale because the UI locale is pinned', () => {
    const value = '2026-07-23T08:30:00Z';
    expect(formatDateTime(value, 'en', 'UTC')).to.equal(formatDateTime(value, 'zh_TW', 'UTC'));
  });

  it('throws when handed an invalid Date instance directly', () => {
    // Current behavior: toDate passes invalid Date instances through, and
    // Intl.DateTimeFormat rejects them at format time.
    expect(() => formatDateTime(new Date('nope'), 'zh-CN')).to.throw(RangeError);
  });
});

describe('formatShortDate', () => {
  it('returns TBD for missing values', () => {
    expect(formatShortDate(null, 'zh-CN')).to.equal('TBD');
    expect(formatShortDate('', 'zh-CN')).to.equal('TBD');
  });

  it('renders month and day only', () => {
    // Local-time construction keeps the assertion independent of the host zone.
    expect(formatShortDate(new Date(2026, 6, 23), 'zh-CN')).to.equal('7月23日');
  });
});

describe('formatRelativeTime', () => {
  const NOW = new Date('2026-07-26T12:00:00Z');
  const rtf = new Intl.RelativeTimeFormat('zh-CN', { numeric: 'auto' });
  const shift = (minutes: number) => new Date(NOW.getTime() + minutes * 60_000);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('falls back to "Just now" for missing or unparseable values', () => {
    expect(formatRelativeTime(null, 'zh-CN')).to.equal('Just now');
    expect(formatRelativeTime('garbage', 'zh-CN')).to.equal('Just now');
  });

  it('uses minutes below one hour', () => {
    expect(formatRelativeTime(shift(0), 'zh-CN')).to.equal(rtf.format(0, 'minute'));
    expect(formatRelativeTime(shift(59), 'zh-CN')).to.equal(rtf.format(59, 'minute'));
    expect(formatRelativeTime(shift(-59), 'zh-CN')).to.equal(rtf.format(-59, 'minute'));
  });

  it('switches to hours at exactly sixty minutes', () => {
    expect(formatRelativeTime(shift(60), 'zh-CN')).to.equal(rtf.format(1, 'hour'));
    expect(formatRelativeTime(shift(-60), 'zh-CN')).to.equal(rtf.format(-1, 'hour'));
  });

  it('rounds half-hours with Math.round semantics', () => {
    // -90 minutes → Math.round(-1.5) = -1 hour (rounds toward positive infinity).
    expect(formatRelativeTime(shift(-90), 'zh-CN')).to.equal(rtf.format(-1, 'hour'));
    expect(formatRelativeTime(shift(90), 'zh-CN')).to.equal(rtf.format(2, 'hour'));
  });

  it('escalates to days when rounded hours reach twenty-four', () => {
    // 23h50m rounds to 24 hours, which fails the <24 check and becomes 1 day.
    expect(formatRelativeTime(shift(23 * 60 + 50), 'zh-CN')).to.equal(rtf.format(1, 'day'));
    expect(formatRelativeTime(shift(-2 * 24 * 60), 'zh-CN')).to.equal(rtf.format(-2, 'day'));
  });

  it('switches to months at thirty days and years at twelve months', () => {
    const day = 24 * 60;
    expect(formatRelativeTime(shift(29 * day), 'zh-CN')).to.equal(rtf.format(29, 'day'));
    expect(formatRelativeTime(shift(30 * day), 'zh-CN')).to.equal(rtf.format(1, 'month'));
    expect(formatRelativeTime(shift(330 * day), 'zh-CN')).to.equal(rtf.format(11, 'month'));
    expect(formatRelativeTime(shift(365 * day), 'zh-CN')).to.equal(rtf.format(1, 'year'));
    expect(formatRelativeTime(shift(-365 * day), 'zh-CN')).to.equal(rtf.format(-1, 'year'));
  });
});

describe('makeInitials', () => {
  it('takes the first letter of the first two words, uppercased', () => {
    expect(makeInitials('john doe')).to.equal('JD');
    expect(makeInitials('John Ronald Reuel')).to.equal('JR');
  });

  it('returns a single initial for one-word names', () => {
    expect(makeInitials('alice')).to.equal('A');
  });

  it('ignores surrounding and repeated whitespace', () => {
    expect(makeInitials('  bob   marley  ')).to.equal('BM');
  });

  it('keeps CJK characters as-is', () => {
    expect(makeInitials('张伟')).to.equal('张');
    expect(makeInitials('张 伟')).to.equal('张伟');
  });

  it('falls back to K when nothing is usable', () => {
    expect(makeInitials('')).to.equal('K');
    expect(makeInitials('   ')).to.equal('K');
  });
});

describe('replaceRouteTokens', () => {
  it('substitutes every token, including numbers', () => {
    expect(replaceRouteTokens('/d/__domainId__/p/__pid__', { domainId: 'system', pid: 1001 }))
      .to.equal('/d/system/p/1001');
  });

  it('replaces repeated occurrences of the same token', () => {
    expect(replaceRouteTokens('__id__/__id__', { id: 'x' })).to.equal('x/x');
  });

  it('uri-encodes replacement values', () => {
    expect(replaceRouteTokens('/p/__pid__', { pid: 'a/b c' })).to.equal('/p/a%2Fb%20c');
  });

  it('leaves unknown tokens and token-free templates untouched', () => {
    expect(replaceRouteTokens('/p/__pid__', { other: 1 })).to.equal('/p/__pid__');
    expect(replaceRouteTokens('/plain', { pid: 1 })).to.equal('/plain');
  });
});

describe('formatPlainTextSummary', () => {
  it('returns an empty string for nullish input', () => {
    expect(formatPlainTextSummary(null)).to.equal('');
    expect(formatPlainTextSummary(undefined)).to.equal('');
    expect(formatPlainTextSummary('')).to.equal('');
  });

  it('stringifies non-string input', () => {
    expect(formatPlainTextSummary(42)).to.equal('42');
  });

  it('drops fenced code blocks entirely', () => {
    expect(formatPlainTextSummary('before\n```js\nconst x = 1;\n```\nafter')).to.equal('before after');
  });

  it('unwraps inline code', () => {
    expect(formatPlainTextSummary('use `foo()` now')).to.equal('use foo() now');
  });

  it('drops images but keeps link labels', () => {
    expect(formatPlainTextSummary('![diagram](https://x/img.png) see [the docs](https://x/docs)'))
      .to.equal('see the docs');
  });

  it('strips raw html tags but keeps their text', () => {
    expect(formatPlainTextSummary('<b>bold</b> and <span class="x">plain</span>')).to.equal('bold and plain');
  });

  it('removes list, heading, and quote markers only at line starts', () => {
    expect(formatPlainTextSummary('# Title\n- item\n> quote\n1. first')).to.equal('Title item quote first');
    expect(formatPlainTextSummary('a - b')).to.equal('a - b');
  });

  it('unwraps emphasis and strikethrough markers', () => {
    expect(formatPlainTextSummary('**bold** *it* __under__ _em_ ~~gone~~')).to.equal('bold it under em gone');
  });

  it('keeps emoji and cjk punctuation', () => {
    expect(formatPlainTextSummary('🎉 恭喜！比赛结束。')).to.equal('🎉 恭喜！比赛结束。');
  });

  it('collapses whitespace runs into single spaces', () => {
    expect(formatPlainTextSummary('  a \n\n  b\tc  ')).to.equal('a b c');
  });
});
