import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SendCommandInput, SendCommandOutcome } from '../src/hooks/use-proctor-commands.ts';
import type { VigilStudentCard, VigilStudentEvent, VigilStudentStatus } from '../src/lib/vigil-api.ts';
import { ConfirmActionDialog } from '../src/pages/vigil/confirm-action-dialog.tsx';
import { EventDetailDialog, ScreenshotLightbox } from '../src/pages/vigil/event-detail-dialog.tsx';
import { SendMessageDialog } from '../src/pages/vigil/send-message-dialog.tsx';
import { StatusPill, statusLabel, StudentCard } from '../src/pages/vigil/student-card.tsx';
import { normalizeVigilTimestamp, parseVigilTimestamp, VigilDateTime } from '../src/pages/vigil/timestamp.tsx';

/* ─── Fixtures ─────────────────────────────────────────────────────────── */

function makeStudent(overrides: Partial<VigilStudentCard> = {}): VigilStudentCard {
  return {
    machineId: 'a1b2c3d4e5f6',
    examSessionId: 'sess-1',
    uid: 42,
    name: '张三',
    studentId: '20231001',
    status: 'online',
    eventCount: 0,
    examSeconds: 47 * 60,
    recentScreenshotUrl: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<VigilStudentEvent> = {}): VigilStudentEvent {
  return {
    eventId: 'ev-1',
    machineId: 'a1b2c3d4e5f6',
    type: 'usb_storage_changed',
    severity: 'warning',
    summary: '检测到 USB 存储设备插入',
    payload: { device: 'Kingston DataTraveler' },
    count: 1,
    firstTs: '2026-07-01 03:00:00',
    lastTs: '2026-07-01 03:05:00',
    ts: '2026-07-01 03:05:00',
    screenshotId: null,
    ...overrides,
  };
}

type SendCommandFn = (input: SendCommandInput) => Promise<SendCommandOutcome>;

function makeSendCommand(outcome: SendCommandOutcome = { accepted: 1, result: null }) {
  return vi.fn<SendCommandFn>().mockResolvedValue(outcome);
}

/* ─── timestamp.tsx ────────────────────────────────────────────────────── */

describe('normalizeVigilTimestamp', () => {
  it('marks naive datetime strings as utc', () => {
    expect(normalizeVigilTimestamp('2026-07-01 03:00:00')).to.equal('2026-07-01T03:00:00Z');
    expect(normalizeVigilTimestamp('2026-07-01T03:00:00')).to.equal('2026-07-01T03:00:00Z');
    expect(normalizeVigilTimestamp('  2026-07-01 03:00:00  ')).to.equal('2026-07-01T03:00:00Z');
  });

  it('leaves already-zoned strings untouched', () => {
    expect(normalizeVigilTimestamp('2026-07-01T03:00:00Z')).to.equal('2026-07-01T03:00:00Z');
    expect(normalizeVigilTimestamp('2026-07-01T03:00:00z')).to.equal('2026-07-01T03:00:00z');
    expect(normalizeVigilTimestamp('2026-07-01T03:00:00+08:00')).to.equal('2026-07-01T03:00:00+08:00');
    expect(normalizeVigilTimestamp('2026-07-01 03:00:00-0500')).to.equal('2026-07-01 03:00:00-0500');
  });

  it('passes through non-strings, blanks and date-only values', () => {
    const d = new Date(1_234_567_890);
    expect(normalizeVigilTimestamp(d)).to.equal(d);
    expect(normalizeVigilTimestamp(1_234_567_890)).to.equal(1_234_567_890);
    expect(normalizeVigilTimestamp(null)).to.equal(null);
    expect(normalizeVigilTimestamp('')).to.equal('');
    expect(normalizeVigilTimestamp('   ')).to.equal('   ');
    expect(normalizeVigilTimestamp('2026-07-01')).to.equal('2026-07-01');
  });
});

describe('parseVigilTimestamp', () => {
  it('parses naive vigil strings as utc instants', () => {
    const d = parseVigilTimestamp('2026-07-01 03:00:00');
    expect(d).to.be.instanceOf(Date);
    expect(d!.getTime()).to.equal(Date.UTC(2026, 6, 1, 3, 0, 0));
  });

  it('passes date instances through unchanged', () => {
    const d = new Date(123_000);
    expect(parseVigilTimestamp(d)).to.equal(d);
  });

  it('returns null for unparseable input', () => {
    expect(parseVigilTimestamp('not-a-date')).to.equal(null);
    expect(parseVigilTimestamp(undefined)).to.equal(null);
    expect(parseVigilTimestamp(new Date(Number.NaN))).to.equal(null);
  });

  it('coerces null to the epoch (documents current behavior)', () => {
    // `new Date(null)` coerces to 0 rather than NaN, so the guard never
    // fires. Arguably a bug — callers passing null get 1970-01-01 instead of
    // null — kept as-is and pinned here so a fix is a deliberate change.
    expect(parseVigilTimestamp(null)!.getTime()).to.equal(0);
  });
});

describe('the VigilDateTime wrapper', () => {
  it('renders a naive vigil timestamp as a utc instant shifted to cst', () => {
    const { container } = render(<VigilDateTime value="2026-07-01 03:00:00" mode="datetime-sec" />);
    const time = container.querySelector('time')!;
    expect(time.getAttribute('datetime')).to.equal('2026-07-01T03:00:00.000Z');
    // Display is locked to UTC+8 → naive-UTC 03:00 renders as 11:00.
    expect(time.textContent).to.equal('2026-07-01 11:00:00');
  });

  it('does not double-shift an explicitly zoned timestamp', () => {
    const { container } = render(<VigilDateTime value="2026-07-01T03:00:00+08:00" mode="datetime-sec" />);
    const time = container.querySelector('time')!;
    expect(time.getAttribute('datetime')).to.equal('2026-06-30T19:00:00.000Z');
    expect(time.textContent).to.equal('2026-07-01 03:00:00');
  });

  it('falls back for unparseable values', () => {
    const { container } = render(<VigilDateTime value="garbage" fallback="无数据" />);
    expect(container.querySelector('time')!.textContent).to.equal('无数据');
  });
});

/* ─── student-card.tsx ─────────────────────────────────────────────────── */

describe('statusLabel', () => {
  it('maps every status token to its chinese label', () => {
    const expected: Record<VigilStudentStatus, string> = {
      online: '在线',
      anomaly: '异常',
      offline: '离线',
      disconnected: '未连接',
      locked: '已锁屏',
      ended: '已结束',
    };
    for (const [status, label] of Object.entries(expected)) {
      expect(statusLabel(status as VigilStudentStatus)).to.equal(label);
    }
  });
});

describe('the StatusPill badge', () => {
  it('renders the translated status text', () => {
    render(<StatusPill status="locked" />);
    expect(screen.getByText('已锁屏')).to.not.equal(null);
  });
});

describe('the StudentCard tile', () => {
  it('renders identity, machine short hash, exam time and anomaly count', () => {
    render(
      <StudentCard
        student={makeStudent({ status: 'anomaly', eventCount: 2 })}
        onClick={vi.fn()}
        onDoubleClick={vi.fn()}
      />,
    );
    expect(screen.getByText('张三')).to.not.equal(null);
    expect(screen.getByText('20231001 · #A1B2C3')).to.not.equal(null);
    expect(screen.getByText('47min')).to.not.equal(null);
    expect(screen.getByText('2 异常')).to.not.equal(null);
    expect(screen.getByText('异常')).to.not.equal(null); // status pill
  });

  it('formats exam durations over an hour as h/m', () => {
    render(<StudentCard student={makeStudent({ examSeconds: 3720 })} onClick={vi.fn()} onDoubleClick={vi.fn()} />);
    expect(screen.getByText('1h2m')).to.not.equal(null);
  });

  it('shows an em dash for a missing student id and hides the anomaly badge at zero events', () => {
    render(
      <StudentCard
        student={makeStudent({ studentId: undefined, eventCount: 0 })}
        onClick={vi.fn()}
        onDoubleClick={vi.fn()}
      />,
    );
    expect(screen.getByText('— · #A1B2C3')).to.not.equal(null);
    expect(screen.queryByText(/异常$/)).to.equal(null);
  });

  it('renders a placeholder instead of an img when no screenshot exists', () => {
    const { container } = render(<StudentCard student={makeStudent()} onClick={vi.fn()} onDoubleClick={vi.fn()} />);
    expect(container.querySelector('img')).to.equal(null);
  });

  it('keeps relative and absolute thumbnail urls verbatim when no vigil base url is cached', () => {
    render(
      <StudentCard
        student={makeStudent({ recentScreenshotUrl: '/api/screenshots/s1/thumbnail' })}
        onClick={vi.fn()}
        onDoubleClick={vi.fn()}
      />,
    );
    expect(screen.getByAltText('张三 截屏').getAttribute('src')).to.equal('/api/screenshots/s1/thumbnail');

    render(
      <StudentCard
        student={makeStudent({ name: '李四', recentScreenshotUrl: 'https://cdn.example/x.png' })}
        onClick={vi.fn()}
        onDoubleClick={vi.fn()}
      />,
    );
    expect(screen.getByAltText('李四 截屏').getAttribute('src')).to.equal('https://cdn.example/x.png');
  });

  it('fires onClick for a single click and onDoubleClick for a double click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onDoubleClick = vi.fn();
    render(<StudentCard student={makeStudent()} onClick={onClick} onDoubleClick={onDoubleClick} />);
    const card = screen.getByRole('button');

    await user.click(card);
    expect(onClick.mock.calls.length).to.equal(1);
    expect(onDoubleClick.mock.calls.length).to.equal(0);

    await user.dblClick(card);
    expect(onDoubleClick.mock.calls.length).to.equal(1);
  });
});

/* ─── confirm-action-dialog.tsx ────────────────────────────────────────── */

describe('the ConfirmActionDialog', () => {
  const baseProps = {
    open: true,
    title: '锁定屏幕？',
    description: '锁定后学生无法继续答题',
    confirmLabel: '确认锁屏',
  };

  it('renders title, description and the optional reason field', () => {
    render(<ConfirmActionDialog {...baseProps} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.getByText('锁定屏幕？')).to.not.equal(null);
    expect(screen.getByText('锁定后学生无法继续答题')).to.not.equal(null);
    expect(screen.getByText('原因（可选）')).to.not.equal(null);
    expect(screen.getByPlaceholderText('（可选）写入审计日志')).to.not.equal(null);
  });

  it('renders nothing while closed', () => {
    render(<ConfirmActionDialog {...baseProps} open={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByText('锁定屏幕？')).to.equal(null);
  });

  it('omits the reason textarea when requireReason is false', () => {
    render(<ConfirmActionDialog {...baseProps} requireReason={false} onOpenChange={vi.fn()} onConfirm={vi.fn()} />);
    expect(screen.queryByPlaceholderText('（可选）写入审计日志')).to.equal(null);
    expect(screen.queryByText('原因（可选）')).to.equal(null);
  });

  it('confirms with the trimmed reason and closes the dialog', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<(reason: string) => void>();
    const onOpenChange = vi.fn();
    render(<ConfirmActionDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    await user.type(screen.getByPlaceholderText('（可选）写入审计日志'), '  怀疑切屏作弊  ');
    await user.click(screen.getByRole('button', { name: '确认锁屏' }));

    await waitFor(() => {
      expect(onConfirm.mock.calls).to.deep.equal([['怀疑切屏作弊']]);
      expect(onOpenChange.mock.calls).to.deep.equal([[false]]);
    });
  });

  it('confirms with an empty reason when nothing is typed', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn<(reason: string) => void>();
    render(<ConfirmActionDialog {...baseProps} onOpenChange={vi.fn()} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: '确认锁屏' }));
    await waitFor(() => {
      expect(onConfirm.mock.calls).to.deep.equal([['']]);
    });
  });

  it('cancels without invoking onConfirm', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<ConfirmActionDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(onConfirm.mock.calls.length).to.equal(0);
    expect(onOpenChange.mock.calls).to.deep.equal([[false]]);
  });

  it('closes on escape while idle', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ConfirmActionDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={vi.fn()} />);

    await user.keyboard('{Escape}');
    expect(onOpenChange.mock.calls).to.deep.equal([[false]]);
  });

  it('blocks dismissal while the confirm action is in flight', async () => {
    const user = userEvent.setup();
    let resolveConfirm!: () => void;
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve;
        }),
    );
    const onOpenChange = vi.fn();
    render(
      <ConfirmActionDialog
        {...baseProps}
        title="强制交卷？"
        confirmLabel="强制交卷"
        confirmVariant="destructive"
        onOpenChange={onOpenChange}
        onConfirm={onConfirm}
      />,
    );

    await user.click(screen.getByRole('button', { name: '强制交卷' }));
    expect(screen.getByRole('button', { name: '强制交卷' })).to.have.property('disabled', true);
    expect(screen.getByRole('button', { name: '取消' })).to.have.property('disabled', true);

    await user.keyboard('{Escape}');
    expect(onOpenChange.mock.calls.length).to.equal(0);

    resolveConfirm();
    await waitFor(() => {
      expect(onOpenChange.mock.calls).to.deep.equal([[false]]);
    });
  });

  it('stays open and re-enables the buttons when onConfirm rejects', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn().mockRejectedValue(new Error('vigil offline'));
    const onOpenChange = vi.fn();
    render(<ConfirmActionDialog {...baseProps} onOpenChange={onOpenChange} onConfirm={onConfirm} />);

    await user.click(screen.getByRole('button', { name: '确认锁屏' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '确认锁屏' })).to.have.property('disabled', false);
    });
    expect(onOpenChange.mock.calls.length).to.equal(0);
    expect(screen.getByText('锁定屏幕？')).to.not.equal(null);
  });
});

/* ─── event-detail-dialog.tsx ──────────────────────────────────────────── */

describe('the EventDetailDialog', () => {
  it('renders nothing when no event is selected', () => {
    render(<EventDetailDialog open onOpenChange={vi.fn()} event={null} />);
    expect(screen.queryByText('行为详情')).to.equal(null);
  });

  it('renders translated type, severity, summary, payload and utc-normalized time', () => {
    render(<EventDetailDialog open onOpenChange={vi.fn()} event={makeEvent()} />);
    // Type label appears in the title and the metadata grid.
    expect(screen.getAllByText('USB 存储设备插拔').length).to.equal(2);
    expect(screen.getByText('警告')).to.not.equal(null);
    expect(screen.getByText('检测到 USB 存储设备插入')).to.not.equal(null);
    expect(document.body.textContent).to.include('Kingston DataTraveler');
    // Naive vigil ts must be interpreted as UTC, not local time.
    expect(document.body.querySelector('time[datetime="2026-07-01T03:05:00.000Z"]')).to.not.equal(null);
    // Single occurrence → no aggregation window row.
    expect(screen.queryByText(/聚合时间窗/)).to.equal(null);
  });

  it('humanises unknown event types instead of throwing', () => {
    render(<EventDetailDialog open onOpenChange={vi.fn()} event={makeEvent({ type: 'foo.bar_baz' })} />);
    expect(screen.getAllByText('foo bar baz').length).to.equal(2);
    expect(screen.getByText('foo.bar_baz')).to.not.equal(null); // raw token kept for grepping
  });

  it('shows the aggregation count and time window for grouped events', () => {
    render(<EventDetailDialog open onOpenChange={vi.fn()} event={makeEvent({ count: 3 })} />);
    expect(screen.getByText('3（聚合）')).to.not.equal(null);
    expect(screen.getByText(/聚合时间窗/)).to.not.equal(null);
  });

  it('shows an empty state when the event has no screenshot', () => {
    render(<EventDetailDialog open onOpenChange={vi.fn()} event={makeEvent()} />);
    expect(screen.getByText('此事件未关联截屏')).to.not.equal(null);
    expect(document.body.querySelector('img')).to.equal(null);
  });

  it('opens a fullscreen lightbox when the screenshot thumbnail is clicked', async () => {
    const user = userEvent.setup();
    render(<EventDetailDialog open onOpenChange={vi.fn()} event={makeEvent({ screenshotId: 'shot-1' })} />);

    const thumb = screen.getByAltText('截屏 shot-1');
    expect(thumb.getAttribute('src')).to.equal('/api/admin/vigil/screenshots/shot-1/thumb');

    await user.click(screen.getByRole('button', { name: '截屏 shot-1' }));
    const srcs = screen.getAllByAltText('截屏 shot-1').map((el) => el.getAttribute('src'));
    expect(srcs).to.include('/api/admin/vigil/screenshots/shot-1/file');
  });
});

describe('the ScreenshotLightbox', () => {
  it('closes on backdrop click but not when clicking the image area', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ScreenshotLightbox screenshotId="shot-9" onClose={onClose} />);

    // The content pane stops propagation so the image itself is not a dismiss target.
    await user.click(screen.getByAltText('截屏 shot-9'));
    expect(onClose.mock.calls.length).to.equal(0);

    // The header bubbles up to the backdrop handler.
    await user.click(screen.getByText('shot-9'));
    expect(onClose.mock.calls.length).to.equal(1);
  });
});

/* ─── send-message-dialog.tsx ──────────────────────────────────────────── */

describe('the SendMessageDialog', () => {
  const bodyBox = () => screen.getByPlaceholderText('发送给学生的消息内容…') as HTMLTextAreaElement;

  it('fixes the audience to the student and hides audience radios in single mode', () => {
    render(<SendMessageDialog open onOpenChange={vi.fn()} student={makeStudent()} sendCommand={makeSendCommand()} />);
    expect(screen.getByText('向 张三 发送消息')).to.not.equal(null);
    expect(screen.getByText('张三 20231001')).to.not.equal(null);
    expect(screen.queryByRole('radio', { name: /全员/ })).to.equal(null);
    // Empty body → submit disabled.
    expect(screen.getByRole('button', { name: '发送' })).to.have.property('disabled', true);
  });

  it('sends a single-target show_message with defaults and closes', async () => {
    const user = userEvent.setup();
    const sendCommand = makeSendCommand();
    const onOpenChange = vi.fn();
    render(<SendMessageDialog open onOpenChange={onOpenChange} student={makeStudent()} sendCommand={sendCommand} />);

    await user.type(bodyBox(), '请注意屏幕');
    expect(screen.getByText('5/500')).to.not.equal(null);
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.length).to.equal(1);
    });
    expect(sendCommand.mock.calls[0][0]).to.deep.equal({
      targetMachineId: 'a1b2c3d4e5f6',
      command: 'show_message',
      payload: { severity: 'info', title: '', body: '请注意屏幕' },
      reason: undefined,
    });
    await waitFor(() => {
      expect(onOpenChange.mock.calls).to.deep.equal([[false]]);
    });
  });

  it('carries severity, trimmed title and audit reason into the payload', async () => {
    const user = userEvent.setup();
    const sendCommand = makeSendCommand();
    render(<SendMessageDialog open onOpenChange={vi.fn()} student={makeStudent()} sendCommand={sendCommand} />);

    await user.click(screen.getByRole('radio', { name: /通知/ }));
    await user.type(screen.getByPlaceholderText('例如：监考通知'), '  监考通知  ');
    await user.type(bodyBox(), '距离结束还有 10 分钟');
    await user.type(screen.getByPlaceholderText('例如：例行提醒考试纪律'), '例行提醒');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.length).to.equal(1);
    });
    expect(sendCommand.mock.calls[0][0]).to.deep.equal({
      targetMachineId: 'a1b2c3d4e5f6',
      command: 'show_message',
      payload: { severity: 'warning', title: '监考通知', body: '距离结束还有 10 分钟' },
      reason: '例行提醒',
    });
  });

  it('single-target critical messages need no extra confirmation checkbox', async () => {
    const user = userEvent.setup();
    render(<SendMessageDialog open onOpenChange={vi.fn()} student={makeStudent()} sendCommand={makeSendCommand()} />);

    await user.click(screen.getByRole('radio', { name: /强制/ }));
    await user.type(bodyBox(), '立即停止操作');
    expect(screen.queryByRole('checkbox')).to.equal(null);
    expect(screen.getByRole('button', { name: '发送' })).to.have.property('disabled', false);
  });

  it('labels group audiences with counters and sends an audience filter', async () => {
    const user = userEvent.setup();
    const sendCommand = makeSendCommand({ accepted: 2, result: null });
    const onOpenChange = vi.fn();
    render(
      <SendMessageDialog
        open
        onOpenChange={onOpenChange}
        counters={{ total: 30, online: 25, anomaly: 2 }}
        sendCommand={sendCommand}
      />,
    );

    expect(screen.getByText('群发消息')).to.not.equal(null);
    expect((screen.getByRole('radio', { name: '全员 30 人' }) as HTMLInputElement).checked).to.equal(true);
    expect(screen.getByRole('radio', { name: '仅在线 25 人' })).to.not.equal(null);

    await user.click(screen.getByRole('radio', { name: '仅异常 2 人' }));
    await user.type(bodyBox(), '回到考试界面');
    // Button label strips the 仅 prefix.
    await user.click(screen.getByRole('button', { name: '发送给异常 2 人' }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.length).to.equal(1);
    });
    expect(sendCommand.mock.calls[0][0]).to.deep.equal({
      audienceFilter: 'anomaly',
      command: 'show_message',
      payload: { severity: 'info', title: '', body: '回到考试界面' },
      reason: undefined,
    });
    await waitFor(() => {
      expect(onOpenChange.mock.calls).to.deep.equal([[false]]);
    });
  });

  it('requires the explicit acknowledgement before a critical group send', async () => {
    const user = userEvent.setup();
    const sendCommand = makeSendCommand({ accepted: 30, result: null });
    render(<SendMessageDialog open onOpenChange={vi.fn()} counters={{ total: 30 }} sendCommand={sendCommand} />);

    await user.click(screen.getByRole('radio', { name: /强制/ }));
    await user.type(bodyBox(), '全体注意：立即停止作答');

    // Body filled but acknowledgement missing → still disabled.
    expect(screen.getByRole('button', { name: '发送给全员 30 人' })).to.have.property('disabled', true);

    await user.click(screen.getByRole('checkbox'));
    const submit = screen.getByRole('button', { name: '发送给全员 30 人' });
    expect(submit).to.have.property('disabled', false);
    await user.click(submit);

    await waitFor(() => {
      expect(sendCommand.mock.calls.length).to.equal(1);
    });
    expect(sendCommand.mock.calls[0][0]).to.deep.equal({
      audienceFilter: 'all',
      command: 'show_message',
      payload: { severity: 'critical', title: '', body: '全体注意：立即停止作答' },
      reason: undefined,
    });
  });

  it('cancels without sending', async () => {
    const user = userEvent.setup();
    const sendCommand = makeSendCommand();
    const onOpenChange = vi.fn();
    render(<SendMessageDialog open onOpenChange={onOpenChange} student={makeStudent()} sendCommand={sendCommand} />);

    await user.type(bodyBox(), '不发了');
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(sendCommand.mock.calls.length).to.equal(0);
    expect(onOpenChange.mock.calls).to.deep.equal([[false]]);
  });

  it('stays open when sendCommand rejects', async () => {
    const user = userEvent.setup();
    const sendCommand = vi.fn<SendCommandFn>().mockRejectedValue(new Error('vigil offline'));
    const onOpenChange = vi.fn();
    render(<SendMessageDialog open onOpenChange={onOpenChange} student={makeStudent()} sendCommand={sendCommand} />);

    await user.type(bodyBox(), '请注意屏幕');
    await user.click(screen.getByRole('button', { name: '发送' }));

    await waitFor(() => {
      expect(sendCommand.mock.calls.length).to.equal(1);
    });
    expect(onOpenChange.mock.calls.length).to.equal(0);
    expect(screen.getByText('向 张三 发送消息')).to.not.equal(null);
  });

  it('resets the form each time the dialog reopens', async () => {
    const user = userEvent.setup();
    const sendCommand = makeSendCommand();
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <SendMessageDialog open onOpenChange={onOpenChange} student={makeStudent()} sendCommand={sendCommand} />,
    );

    await user.click(screen.getByRole('radio', { name: /强制/ }));
    await user.type(bodyBox(), '第一条消息');

    rerender(<SendMessageDialog open={false} onOpenChange={onOpenChange} student={makeStudent()} sendCommand={sendCommand} />);
    rerender(<SendMessageDialog open onOpenChange={onOpenChange} student={makeStudent()} sendCommand={sendCommand} />);

    expect(bodyBox().value).to.equal('');
    expect((screen.getByRole('radio', { name: /提醒/ }) as HTMLInputElement).checked).to.equal(true);
    expect(screen.getByRole('button', { name: '发送' })).to.have.property('disabled', true);
  });
});
