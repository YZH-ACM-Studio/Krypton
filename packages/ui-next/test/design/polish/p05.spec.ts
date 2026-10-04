import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../../../src/lib/bootstrap';
import { VirtualContestScoreboardPage } from '../../../src/pages/virtual-contest';

const packageRoot = resolve(import.meta.dirname, '../../..');

// ACM scoreboardHeader puts a newline in the solved column. An unsubmitted
// record cell is value:'' (no rid). An accepted cell is "+n\nminutes".
const SOLVED = 2;
const UNSUBMITTED = 3;
const ACCEPTED = 4;

interface ScoreboardCell {
  type?: string;
  value?: unknown;
}

function scoreboardBootstrap(): KryptonBootstrap {
  const rows: ScoreboardCell[][] = [
    [
      { type: 'rank', value: '#' },
      { type: 'user', value: '用户' },
      { type: 'solved', value: '通过\n总时间' },
      { type: 'problem', value: 'A' },
      { type: 'problem', value: 'B' },
    ],
    [
      { type: 'rank', value: '1' },
      { type: 'user', value: 'alice' },
      { type: 'time', value: '1\n0:03:12' },
      { type: 'record', value: '' },
      { type: 'record', value: '+2\n48' },
    ],
  ];
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh-CN',
    theme: 'light',
    generatedAt: '2026-10-04T00:00:00.000Z',
    user: { id: 1, name: 'student', signedIn: true } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {} as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'contest_virtual_scoreboard.html',
      data: { tdoc: { docId: 'tid', title: '虚拟赛' }, rows },
    },
  };
}

function renderBoard(): HTMLElement {
  return render(
    createElement(BootstrapProvider, { bootstrap: scoreboardBootstrap() }, createElement(VirtualContestScoreboardPage)),
  ).container;
}

function bodyCells(container: HTMLElement): HTMLElement[] {
  const row = container.querySelector('tbody tr');
  expect(row, 'scoreboard body row').toBeInstanceOf(HTMLTableRowElement);
  if (!(row instanceof HTMLTableRowElement)) {
    throw new TypeError('scoreboard body row missing');
  }
  return [...row.querySelectorAll('td')];
}

function keepsHeaderBreak(cell: HTMLElement): boolean {
  return cell.classList.contains('whitespace-pre-line') || cell.querySelector('br') !== null;
}

describe('p05 virtual scoreboard empty cells, header breaks, time size', () => {
  it('未提交格子的文本为空串', () => {
    const cell = bodyCells(renderBoard())[UNSUBMITTED];
    expect(cell, 'unsubmitted cell').toBeInstanceOf(HTMLElement);
    expect(cell?.textContent).toBe('');
  });

  it('表头单元格保留换行', () => {
    const header = renderBoard().querySelectorAll('thead th').item(SOLVED);
    expect(header, 'solved header').toBeInstanceOf(HTMLElement);
    if (!(header instanceof HTMLElement)) {
      throw new TypeError('solved header missing');
    }
    expect(header.textContent ?? '').toContain('通过');
    expect(header.textContent ?? '').toContain('总时间');
    expect(keepsHeaderBreak(header), header.className).toBe(true);
  });

  it('通过格第二行使用 text-2xs', () => {
    const cell = bodyCells(renderBoard())[ACCEPTED];
    expect(cell, 'accepted cell').toBeInstanceOf(HTMLElement);
    if (!(cell instanceof HTMLElement)) {
      throw new TypeError('accepted cell missing');
    }
    const second = [...cell.querySelectorAll('*')].find((node): node is HTMLElement => (
      node instanceof HTMLElement && node.classList.contains('text-2xs') && node.textContent?.trim() === '48'
    ));
    expect(second, cell.innerHTML).toBeInstanceOf(HTMLElement);
  });

  it('门禁零违规', () => {
    let status = 0;
    try {
      execFileSync(process.execPath, ['scripts/design-gate.mjs', '--file', 'src/pages/virtual-contest.tsx'], {
        cwd: packageRoot,
        stdio: 'pipe',
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number') {
        status = error.status;
      } else {
        throw error;
      }
    }
    expect(status).toBe(0);
  });
});
