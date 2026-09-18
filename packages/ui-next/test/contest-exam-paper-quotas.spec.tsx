import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BootstrapProvider, type KryptonBootstrap } from '../src/lib/bootstrap.tsx';
import { ContestEditPage } from '../src/pages/contest-manage.tsx';
import {
  ContestExamPaperQuotas,
  countExamPaperPoolFromPdict,
  examPaperQuotaDraft,
  examPaperQuotaPoolShortfalls,
  serializeExamPaperQuotasField,
} from '../src/pages/contest-exam-paper-quotas';

const CONTEST_ID = '66bf00000000000000000101';

function editBootstrap(rule: string): KryptonBootstrap {
  const tdoc = {
    title: '2026 期末',
    beginAt: '2026-08-20T01:00:00.000Z',
    endAt: '2026-08-20T04:00:00.000Z',
    _id: CONTEST_ID,
    docId: CONTEST_ID,
    rule,
    owner: 2,
    pids: [11],
    files: [],
    duration: 1.5,
    examPaperQuotas: { single: 1 },
  };
  return {
    appName: 'Krypton',
    siteName: 'Krypton OJ',
    locale: 'zh_CN',
    theme: 'light',
    generatedAt: '2026-08-15T00:00:00.000Z',
    user: { id: 2, name: 'teacher', signedIn: true, priv: 0 } as KryptonBootstrap['user'],
    domain: { id: 'system', name: '主域', bulletin: '', avatar: '' },
    urls: {
      contests: '/contest',
      contestDetail: '/contest/:TID',
      problemDetail: '/p/:PID',
    } as KryptonBootstrap['urls'],
    udict: {},
    page: {
      templateName: 'contest_edit.html',
      data: {
        page_name: 'contest_edit',
        tdoc,
        rules: { acm: 'ACM', exam: '考试' },
        duration: 3,
        pids: '11',
        pdict: { 11: { title: '单选', problemKind: 'single' } },
        beginAt: tdoc.beginAt,
        scopeSchools: [],
        scopeGroups: [],
        teamBatches: [],
      },
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('contest exam paper quotas', () => {
  it('counts tdoc.pids by pdict.problemKind and treats missing kind as programming', () => {
    expect(
      countExamPaperPoolFromPdict([1, 2, 3], {
        1: { problemKind: 'single' },
        2: {},
      }),
    ).to.deep.equal({
      programming: 2,
      single: 1,
      multi: 0,
      true_false: 0,
      blank: 0,
      subjective: 0,
      program_fill: 0,
      function: 0,
    });
  });

  it('serializes only kinds with count >= 1 and omits an empty draw', () => {
    expect(
      serializeExamPaperQuotasField({
        programming: '2',
        single: '0',
        multi: '',
        true_false: '1',
        blank: '',
        subjective: '  ',
        program_fill: '3',
        function: '',
      }),
    ).to.equal(JSON.stringify({ programming: 2, true_false: 1, program_fill: 3 }));
    expect(
      serializeExamPaperQuotasField({
        programming: '',
        single: '0',
        multi: '',
        true_false: '',
        blank: '',
        subjective: '',
        program_fill: '',
        function: '',
      }),
    ).to.equal('');
  });

  it('keeps invalid quota drafts as a payload so save fail-closes instead of drawing off', () => {
    expect(
      serializeExamPaperQuotasField({
        programming: '2',
        single: '0',
        multi: '',
        true_false: '1',
        blank: '1.5',
        subjective: '  ',
        program_fill: '3',
        function: '-1',
      }),
    ).to.equal(JSON.stringify({ programming: 2, true_false: 1, blank: 1.5, program_fill: 3, function: -1 }));
    expect(
      serializeExamPaperQuotasField({
        programming: '',
        single: '1.5',
        multi: '',
        true_false: '',
        blank: '',
        subjective: '',
        program_fill: '',
        function: '',
      }),
    ).to.equal(JSON.stringify({ single: 1.5 }));
  });

  it('lists kinds whose quota exceeds the pdict pool and ignores 0/empty/non-integers', () => {
    const pool = countExamPaperPoolFromPdict([11, 12], {
      11: { problemKind: 'single' },
      12: { problemKind: 'single' },
    });
    expect(examPaperQuotaPoolShortfalls(examPaperQuotaDraft({ single: 1 }), pool)).to.deep.equal([]);
    expect(
      examPaperQuotaPoolShortfalls(
        {
          ...examPaperQuotaDraft(),
          single: '3',
          blank: '1.5',
          multi: '0',
        },
        pool,
      ),
    ).to.deep.equal(['single']);
  });

  it('submits examPaperQuotas JSON only when at least one kind is drawn', async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <ContestExamPaperQuotas
        pids={[11, 12]}
        pdict={{ 11: { problemKind: 'single' }, 12: { problemKind: 'single' } }}
        quotas={{ single: 1 }}
      />,
    );
    expect(screen.getByText('按题型抽题')).to.exist;
    expect((screen.getByLabelText(/单选/) as HTMLInputElement).value).to.equal('1');
    expect(screen.getByText('题库 2')).to.exist;
    expect((container.querySelector('input[name="examPaperQuotas"]') as HTMLInputElement | null)?.value).to.equal(
      JSON.stringify({ single: 1 }),
    );

    await user.clear(screen.getByLabelText(/单选/));
    expect(container.querySelector('input[name="examPaperQuotas"]')).to.equal(null);

    rerender(<ContestExamPaperQuotas pids={[11]} pdict={{ 11: {} }} />);
    expect(screen.getByText('题库 1')).to.exist;
  });

  it('blocks form save when a quota exceeds the pool and keeps the JSON field', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <form>
        <ContestExamPaperQuotas
          pids={[11]}
          pdict={{ 11: { problemKind: 'single' } }}
          quotas={{ single: 2 }}
        />
        <button type="submit">保存</button>
      </form>,
    );
    expect(screen.getByText('题型数量不足，不能保存抽题')).to.exist;
    expect((container.querySelector('input[name="examPaperQuotas"]') as HTMLInputElement).value).to.equal(
      JSON.stringify({ single: 2 }),
    );

    const blocked = new Event('submit', { bubbles: true, cancelable: true });
    container.querySelector('form')?.dispatchEvent(blocked);
    expect(blocked.defaultPrevented).to.equal(true);

    await user.clear(screen.getByLabelText(/单选/));
    await user.type(screen.getByLabelText(/单选/), '1');
    expect(screen.queryByText('题型数量不足，不能保存抽题')).to.equal(null);

    const allowed = new Event('submit', { bubbles: true, cancelable: true });
    container.querySelector('form')?.dispatchEvent(allowed);
    expect(allowed.defaultPrevented).to.equal(false);
  });

  it('shows the exam duration hint and quotas only when rule is exam', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ events: [], schools: [], pdocs: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    const { unmount } = render(
      <BootstrapProvider bootstrap={editBootstrap('exam')}>
        <ContestEditPage />
      </BootstrapProvider>,
    );
    const wallClock = screen.getByLabelText('整场关门（小时）') as HTMLInputElement;
    expect(wallClock.name).to.equal('duration');
    expect(wallClock.value).to.equal('3');
    const personalClock = screen.getByLabelText('开考后个人时长（小时）') as HTMLInputElement;
    expect(personalClock.name).to.equal('contestDuration');
    expect(personalClock.value).to.equal('1.5');
    expect(screen.getByText('开考后个人时长；剩余整场时间不够一场则不能开考。与整场关门不是同一字段。')).to.exist;
    expect(screen.getByText('按题型抽题')).to.exist;
    expect((document.querySelector('input[name="examPaperQuotas"]') as HTMLInputElement | null)?.value).to.equal(
      JSON.stringify({ single: 1 }),
    );
    unmount();
    render(
      <BootstrapProvider bootstrap={editBootstrap('acm')}>
        <ContestEditPage />
      </BootstrapProvider>,
    );
    await user.click(screen.getByRole('button', { name: '比赛设置' }));
    const acmPersonal = screen.getByLabelText('弹性时长 (小时)') as HTMLInputElement;
    expect(acmPersonal.name).to.equal('contestDuration');
    expect(acmPersonal.value).to.equal('1.5');
    expect(screen.queryByText('开考后个人时长；剩余全局时间不够一场则不能开考')).to.equal(null);
    expect(screen.queryByText('开考后个人时长；剩余整场时间不够一场则不能开考。与整场关门不是同一字段。')).to.equal(null);
    expect(screen.queryByText('按题型抽题')).to.equal(null);
    expect(document.querySelector('input[name="examPaperQuotas"]')).to.equal(null);
  });
});
