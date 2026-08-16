import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollArea } from '../src/components/ui/scroll-area';

const pkg = resolve(import.meta.dirname, '..');

function source(relativePath: string): string {
  return readFileSync(resolve(pkg, relativePath), 'utf8');
}

function WideRecordTable() {
  return (
    <table className="min-w-[620px] w-full text-xs">
      <thead>
        <tr>
          <th>状态</th>
          <th>语言</th>
          <th>分数</th>
          <th>时间</th>
          <th>内存</th>
          <th>提交时间</th>
          <th>详情</th>
        </tr>
      </thead>
    </table>
  );
}

function viewportOverflowX(container: HTMLElement): string {
  const viewport = container.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
  expect(viewport, 'ScrollArea viewport').not.to.equal(null);
  return viewport!.style.overflowX || getComputedStyle(viewport!).overflowX;
}

describe('both-axis table scroll', () => {
  it('lets a min-w-[620px] table stay horizontally reachable through the shipped ScrollArea', () => {
    const clipped = render(
      <div style={{ width: 280, height: 160 }}>
        <ScrollArea className="h-full">
          <WideRecordTable />
        </ScrollArea>
      </div>,
    );
    expect(viewportOverflowX(clipped.container)).to.equal('hidden');
    clipped.unmount();

    const reachable = render(
      <div style={{ width: 280, height: 160 }}>
        <ScrollArea className="h-full" orientation="both">
          <WideRecordTable />
        </ScrollArea>
      </div>,
    );
    expect(viewportOverflowX(reachable.container)).to.match(/^(scroll|auto)$/);
  });

  it('uses that both-axis owner around the IDE records table and the training roster', () => {
    const problemDetail = source('src/pages/problem-detail.tsx');
    const tableAt = problemDetail.indexOf('className="min-w-[620px] w-full text-xs"');
    expect(tableAt, 'IDE records table').to.be.greaterThan(-1);
    const recordsWrap = problemDetail.slice(Math.max(0, tableAt - 1600), tableAt);
    expect(recordsWrap).to.match(/<ScrollArea\b[^>]*orientation="both"/);

    const training = source('src/pages/training.tsx');
    const rosterAt = training.indexOf('placeholder="搜索用户名/姓名/学号/班级"');
    expect(rosterAt, 'training roster search').to.be.greaterThan(-1);
    const roster = training.slice(rosterAt, rosterAt + 900);
    expect(roster).to.include('用户名');
    expect(roster).to.include('真实姓名');
    expect(roster).to.include('学号');
    expect(roster).to.include('班级组');
    expect(roster).to.include('进度');
    expect(roster).to.match(/<ScrollArea\b[^>]*orientation="both"/);
  });
});
