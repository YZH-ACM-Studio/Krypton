import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScrollArea } from '../src/components/ui/scroll-area';
import { Table } from '../src/components/ui/table';

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

function viewportOverflow(container: HTMLElement, axis: 'X' | 'Y'): string {
  const viewport = container.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
  expect(viewport, 'ScrollArea viewport').not.to.equal(null);
  const inline = axis === 'X' ? viewport!.style.overflowX : viewport!.style.overflowY;
  const computed = axis === 'X' ? getComputedStyle(viewport!).overflowX : getComputedStyle(viewport!).overflowY;
  return inline || computed;
}

function viewportOverflowX(container: HTMLElement): string {
  return viewportOverflow(container, 'X');
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
    const tableAt = problemDetail.indexOf('>状态</th>');
    expect(tableAt, 'IDE records table').to.be.greaterThan(-1);
    const recordsWrap = problemDetail.slice(Math.max(0, tableAt - 1600), tableAt);
    expect(recordsWrap).to.match(/<ScrollArea\b[^>]+orientation="both"/);

    const roster = source('src/components/practice-roster.tsx');
    expect(roster).to.include('placeholder="搜索用户名/姓名/学号/班级"');
    expect(roster).to.include('用户名');
    expect(roster).to.include('真实姓名');
    expect(roster).to.include('学号');
    expect(roster).to.include('班级组');
    expect(roster).to.include('进度');
    expect(roster.match(/<ScrollArea\b[^>]+orientation="both"/g)?.length, 'both roster tables').to.equal(2);
    const membersAt = roster.indexOf('>用户名</th>');
    expect(membersAt, 'members table min-w').to.be.greaterThan(-1);
    expect(roster.slice(Math.max(0, membersAt - 400), membersAt)).to.match(/<ScrollArea\b[^>]+orientation="both"/);
    expect(roster).to.include('176 + matrixColumns.length * 96');
  });

  it('keeps Table horizontal by default and only enables both when asked', () => {
    const horizontal = render(
      <div style={{ width: 280, height: 160 }}>
        <Table>
          <thead>
            <tr>
              <th>状态</th>
            </tr>
          </thead>
        </Table>
      </div>,
    );
    expect(viewportOverflowX(horizontal.container)).to.match(/^(scroll|auto)$/);
    expect(viewportOverflow(horizontal.container, 'Y')).to.equal('hidden');
    horizontal.unmount();

    const both = render(
      <div style={{ width: 280, height: 160 }}>
        <Table orientation="both">
          <thead>
            <tr>
              <th>状态</th>
            </tr>
          </thead>
        </Table>
      </div>,
    );
    expect(viewportOverflowX(both.container)).to.match(/^(scroll|auto)$/);
    expect(viewportOverflow(both.container, 'Y')).to.match(/^(scroll|auto)$/);
  });
});
