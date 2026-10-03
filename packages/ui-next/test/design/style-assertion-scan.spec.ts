// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  DOM_CLASS_WHITELIST,
  findStyleAssertions,
  isUtilityToken,
  parseIntents,
} from './style-assertion-scan.ts';

function expectOne(source: string, kind: 'source-class' | 'dom-class' | 'class-locator'): void {
  const lineText = source.split('\n')[0]?.trim() ?? '';
  expect(findStyleAssertions(source)).toEqual([
    { line: 1, kind, text: lineText },
  ]);
}

function expectNone(source: string): void {
  expect(findStyleAssertions(source)).toEqual([]);
}

function thrownError(run: () => void): Error {
  try {
    run();
  } catch (error) {
    if (error instanceof Error) return error;
    throw new TypeError('parseIntents threw a non-Error');
  }
  throw new TypeError('parseIntents did not throw');
}

describe('isUtilityToken', () => {
  it('accepts variants, important and negative prefixes, arbitrary values, and bare utilities', () => {
    const tokens = [
      'sm:flex',
      'hover:bg-accent/50',
      '[&>div]:min-w-0',
      '-mx-1',
      'shrink-0',
      'line-clamp-2',
      'touch-pan-x',
      'focus-visible:ring-2',
      'motion-reduce:transition-none',
      'h-[calc(100dvh-4.5rem)]',
      'group',
    ];
    for (const token of tokens) {
      expect({ token, utility: isUtilityToken(token) }).toEqual({ token, utility: true });
    }
  });

  it('rejects attribute snippets, plain words, and non-class identifiers', () => {
    const tokens = [
      'type="hidden"',
      'placeholder',
      'name',
      '搜索',
      'flexible',
      'textarea',
      'P1001',
    ];
    for (const token of tokens) {
      expect({ token, utility: isUtilityToken(token) }).toEqual({ token, utility: false });
    }
  });

  it('strips every variant prefix, then every leading important or negative mark', () => {
    const tokens = ['sm:hover:flex', '!flex', '!-mx-1', 'sm:!flex'];
    for (const token of tokens) {
      expect({ token, utility: isUtilityToken(token) }).toEqual({ token, utility: true });
    }
  });

  it('rejects a token that is empty after variant and important or negative marks are removed', () => {
    const tokens = ['', 'sm:', '-', '!'];
    for (const token of tokens) {
      expect({ token, utility: isUtilityToken(token) }).toEqual({ token, utility: false });
    }
  });

  it('accepts bare contents and the p and tabular-nums prefixes', () => {
    const tokens = ['contents', 'p-4', 'tabular-nums'];
    for (const token of tokens) {
      expect({ token, utility: isUtilityToken(token) }).toEqual({ token, utility: true });
    }
  });

  it('rejects a prefix name that is not followed by a hyphen', () => {
    const tokens = ['from', 'content', 'to', 'via', 'select', 'order', 'place'];
    const actual: Record<string, boolean> = {};
    for (const token of tokens) {
      actual[token] = isUtilityToken(token);
    }
    expect(actual).toEqual({
      from: false,
      content: false,
      to: false,
      via: false,
      select: false,
      order: false,
      place: false,
    });
  });

  it('accepts hyphenated prefixes, invisible, visible, and a bare trailing hyphen', () => {
    const tokens = ['from-brand', 'content-center', 'auto-rows-fr', 'invisible', 'visible', 'rounded-'];
    const actual: Record<string, boolean> = {};
    for (const token of tokens) {
      actual[token] = isUtilityToken(token);
    }
    expect(actual).toEqual({
      'from-brand': true,
      'content-center': true,
      'auto-rows-fr': true,
      invisible: true,
      visible: true,
      'rounded-': true,
    });
  });

  it('accepts peer and an ease- token', () => {
    const tokens = ['peer', 'ease-out'];
    const actual: Record<string, boolean> = {};
    for (const token of tokens) {
      actual[token] = isUtilityToken(token);
    }
    expect(actual).toEqual({
      peer: true,
      'ease-out': true,
    });
  });
});

describe('dom class whitelist', () => {
  it('lists only the layout tokens that a rendered-class assertion may keep', () => {
    expect(DOM_CLASS_WHITELIST).toEqual([
      'min-h-0',
      'min-w-0',
      'flex-1',
      'shrink-0',
      'h-full',
      'w-full',
      'max-w-full',
      'overflow-hidden',
      'overflow-auto',
      'overflow-y-auto',
      'overflow-x-auto',
      'overscroll-contain',
      'sticky',
      'fixed',
      'absolute',
      'relative',
    ]);
  });
});

describe('findStyleAssertions', () => {
  it('flags a source include of several utility classes as one source-class hit', () => {
    expectOne(
      "expect(page).to.include('min-w-0 flex-1 break-words font-semibold line-clamp-2');",
      'source-class',
    );
  });

  it('flags a whitelisted token inside a source assertion', () => {
    expectOne("expect(src).to.include('shrink-0');", 'source-class');
  });

  it('ignores a placeholder attribute that is not a class name', () => {
    expectNone('expect(src).to.include(\'placeholder="搜索用户名"\');');
  });

  it('ignores toHaveClass and .className checks that only use the whitelist', () => {
    expectNone("expect(el).toHaveClass('min-h-0', 'overflow-y-auto');");
    expectNone("expect(body?.className).to.include('min-h-0');");
  });

  it('flags toHaveClass of a non-whitelisted utility as dom-class', () => {
    expectOne("expect(el).toHaveClass('text-amber-700');", 'dom-class');
  });

  it('flags a className capture and an indexOf of a utility as class-locator', () => {
    expectOne('const m = src.match(/<main className="([^"]+)"/);', 'class-locator');
    expectOne("const at = src.indexOf('h-[calc(100dvh-4.5rem)]');", 'class-locator');
  });

  it('flags assert.match and a negated match whose literal contains a utility', () => {
    expectOne('assert.match(src, /touch-pan-x/);', 'source-class');
    expectOne('expect(src).not.to.match(/<div className="flex-1" \\/>/);', 'source-class');
  });

  it('counts a utility literal on the next line as a hit on the expect line', () => {
    const source = [
      'expect(home).to.include(',
      '  \'className="group min-w-0 rounded-lg border"\',',
      ');',
    ].join('\n');
    expectOne(source, 'source-class');
  });

  it('ignores non-class attributes inside an include literal', () => {
    expectNone('expect(markup).to.include(\'name="rule" value="acm"\');');
  });

  it('ignores a tag with type=hidden and flags className="hidden sm:block"', () => {
    expectNone('expect(markup).to.include(\'<input type="hidden" name="rule"\');');
    expectOne('expect(src).to.include(\'className="hidden sm:block"\');', 'source-class');
  });

  it('trims whitespace around the hit line', () => {
    expectOne("  expect(src).to.include('shrink-0');  ", 'source-class');
  });

  it('flags lastIndexOf and search of a utility as class-locator', () => {
    expectOne("const at = src.lastIndexOf('shrink-0');", 'class-locator');
    expectOne("const at = src.search('shrink-0');", 'class-locator');
  });

  it('does not flag indexOf when the literal has no utility token', () => {
    expectNone("const at = src.indexOf('placeholder');");
  });

  it('flags a class attribute the same way as className', () => {
    expectOne("expect(src).to.include('class=\"flex\"');", 'source-class');
  });

  it('flags chai contain of a utility as source-class', () => {
    expectOne("expect(src).to.contain('flex');", 'source-class');
  });

  it('does not treat a toHaveClass line as source-class when every token is whitelisted', () => {
    expectNone("expect(el).toHaveClass('min-h-0'); expect(src).to.include('shrink-0');");
  });

  it('flags a className capture group that is not a character class as class-locator', () => {
    expectOne('const m = src.match(/<div className="(flex|grid)"/);', 'class-locator');
  });

  it('flags an escaped className capture as class-locator', () => {
    expectOne('const m = src.match(/<main className=\\"([^"]+)\\"/);', 'class-locator');
  });

  it('flags toContain on .className when the token is outside the whitelist', () => {
    expectOne("expect(el.className).toContain('text-amber-700');", 'dom-class');
  });

  it('checks every literal on the line, so a later non-whitelisted class still counts', () => {
    expectOne("expect(el).toHaveClass('min-h-0', 'text-amber-700');", 'dom-class');
  });

  it('sees utilities on both sides of .* inside a regex literal', () => {
    expectOne('assert.match(src, /flex.*grid/);', 'source-class');
  });

  it('does not treat bare from, content, or an import path as a utility class', () => {
    expectNone('expect(resolver).to.include("from \'@/pages/collect\'");');
    expectNone("expect(editor).to.include('{ content }');");
    expectNone('expect(src).to.match(/import \\{ x \\} from \'\\.\\/a\'/);');
  });

  it('flags a negated match whose negated character class hides a utility', () => {
    expectOne('expect(detail).not.to.match(/<SheetContent[^>]*overflow-y-auto/);', 'source-class');
  });

  it('flags a ClassName attribute whose value is an arbitrary variant', () => {
    expectOne(
      'expect(src).to.include(\'contentClassName="[&_[role=option]]:min-h-10"\');',
      'source-class',
    );
  });

  it('flags utilities inside a template passed to new RegExp', () => {
    // Scanner input is raw test source: each regex escape is two backslashes, as in mindmap-workspace.spec.ts.
    const source = [
      'expect(page).to.match(new RegExp(`data-mindmap-panel="',
      '{panel}"[\\\\s\\\\S]*?rounded-[^\\\\s\'"]+[\\\\s\\\\S]*?bg-card`));',
    ].join('$');
    expectOne(source, 'source-class');
  });

  it('flags auto-rows and a quoted invisible token inside a string literal', () => {
    expectOne("expect(src).not.to.include('auto-rows-fr');", 'source-class');
    expectOne('expect(src).not.to.include("!task.description && \'invisible\'");', 'source-class');
  });

  it('flags a className literal stored in a variable, with no assertion call', () => {
    expectOne('const titleClass = \'className="min-w-0 flex-1 truncate"\';', 'source-class');
  });

  it('flags startsWith, endsWith, split, and classList.contains as class-locator', () => {
    expectOne("expect(cls.startsWith('rounded')).to.equal(false);", 'class-locator');
    expectOne("expect(cls.endsWith('truncate')).to.equal(true);", 'class-locator');
    expectOne("const parts = src.split('shrink-0');", 'class-locator');
    expectOne("expect(node.classList.contains('truncate')).to.equal(true);", 'class-locator');
  });

  it('flags toContain and assert.doesNotMatch of a utility as source-class', () => {
    expectOne("expect(src).toContain('flex');", 'source-class');
    expectOne('assert.doesNotMatch(src, /flex/);', 'source-class');
  });

  it('flags toMatch on .className when the token is outside the whitelist', () => {
    expectOne('expect(el.className).toMatch(/text-amber-700/);', 'dom-class');
  });

  it('blanks a template interpolation instead of reading the code inside it as classes', () => {
    const hole = String.fromCharCode(36, 123);
    expectNone(`expect(src).to.include(\`${hole}flex}\`);`);
    expectOne(`expect(src).to.match(new RegExp(\`flex${hole}x}grid\`));`, 'source-class');
  });

  it('still sees both sides of a regex alternation', () => {
    expectOne('expect(src).to.match(/flex|grid/);', 'source-class');
  });

  it('reads a regex literal that starts after an equals sign', () => {
    expectOne('expect(src).to.match(re); const re = /flex/;', 'source-class');
  });

  it('does not borrow the next line when the call already has its own literal', () => {
    const source = [
      "expect(src).to.include('placeholder');",
      "expect(src).to.include('flex');",
    ].join('\n');
    expect(findStyleAssertions(source)).toEqual([
      { line: 2, kind: 'source-class', text: "expect(src).to.include('flex');" },
    ]);
  });
});

describe('parseIntents', () => {
  it('returns one intent per section, splitting on the first :: and dropping backticks', () => {
    const markdown = [
      '## test/collect-pages.spec.ts::keeps left::right together',
      '- 源文件：`src/pages/collect.tsx`',
      '- 删除的断言：`expect(page).to.include(\'min-h-0\')`',
      '- 意图（一句话）：列表区域必须能独立滚动。',
      '- 后续阶段应如何表达：页面迁移后保留滚动容器。',
      '',
      '##  test/admin-pages.spec.tsx :: shows the admin shell',
      '- 源文件：src/pages/admin.tsx',
      '- 意图（一句话）：管理壳占满宽度。',
    ].join('\n');
    expect(parseIntents(markdown)).toEqual([
      {
        testFile: 'test/collect-pages.spec.ts',
        itName: 'keeps left::right together',
        sourceFile: 'src/pages/collect.tsx',
      },
      {
        testFile: 'test/admin-pages.spec.tsx',
        itName: 'shows the admin shell',
        sourceFile: 'src/pages/admin.tsx',
      },
    ]);
  });

  it('throws an Error whose message contains the heading when :: or the source line is missing', () => {
    const missingSeparator = [
      '## collect list has no separator',
      '- 源文件：src/pages/collect.tsx',
    ].join('\n');
    const missingSource = [
      '## test/home-training-progress.spec.ts::fills the shared width',
      '- 意图（一句话）：没有源文件行。',
    ].join('\n');
    expect(thrownError(() => {
      parseIntents(missingSeparator);
    }).message).toContain('collect list has no separator');
    expect(thrownError(() => {
      parseIntents(missingSource);
    }).message).toContain('test/home-training-progress.spec.ts::fills the shared width');
  });

  it('throws for a later section that does not have its own source file', () => {
    const markdown = [
      '## test/a.spec.ts::first section',
      '- 源文件：src/pages/a.tsx',
      '## test/b.spec.ts::second section',
      '- 意图（一句话）：没有源文件。',
    ].join('\n');
    expect(thrownError(() => {
      parseIntents(markdown);
    }).message).toContain('test/b.spec.ts::second section');
  });
});
