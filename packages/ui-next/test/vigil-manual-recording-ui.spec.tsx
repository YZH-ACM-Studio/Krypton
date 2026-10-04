import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { VigilStudentCard } from '../src/lib/vigil-api.ts';
import { StudentCard } from '../src/pages/vigil/student-card.tsx';
import { StudentDetailSheet } from '../src/pages/vigil/student-detail-sheet.tsx';

const CONTEST_ID = 'c1';
const MACHINE_ID = 'm1';
const ACTOR = { uid: 7, displayName: 'T' };

const { setManualRecording, listStudentEvents, bootstrapUser } = vi.hoisted(() => ({
  setManualRecording: vi.fn<
    (
      contestId: string,
      machineId: string,
      enabled: boolean,
      actor: { uid: number; displayName: string },
    ) => Promise<{ ok: boolean; recording: boolean }>
  >(),
  listStudentEvents: vi.fn<(...args: unknown[]) => Promise<readonly never[]>>(),
  bootstrapUser: { id: 7, name: 'T' },
}));

vi.mock('@/lib/vigil-api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/vigil-api.ts')>('@/lib/vigil-api');
  return {
    ...actual,
    setManualRecording,
    listStudentEvents,
  };
});

vi.mock('@/lib/bootstrap', () => ({
  useBootstrap: () => ({ user: bootstrapUser }),
}));

function makeStudent(overrides: Partial<VigilStudentCard> = {}): VigilStudentCard {
  return {
    machineId: MACHINE_ID,
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

function renderCard(student: VigilStudentCard) {
  return render(<StudentCard student={student} onClick={vi.fn()} onDoubleClick={vi.fn()} />);
}

function sheetElement(student: VigilStudentCard, recordEnabled = false, newEventVersion = 0) {
  return (
    <StudentDetailSheet
      open
      onOpenChange={vi.fn()}
      contestId={CONTEST_ID}
      student={student}
      recordEnabled={recordEnabled}
      newEventVersion={newEventVersion}
    />
  );
}

function renderSheet(student: VigilStudentCard, recordEnabled = false, newEventVersion = 0) {
  return render(sheetElement(student, recordEnabled, newEventVersion));
}

function screenLabelText(): string {
  const label = screen.getByText('录屏');
  return label.parentElement?.textContent ?? '';
}

describe('student card manual recording indicator', () => {
  it('shows 录制中 when manualRecording is true', () => {
    renderCard(makeStudent({ manualRecording: true }));
    const badge = screen.getByText('录制中');
    expect(badge.getAttribute('data-slot')).toBe('badge');
    expect(badge.getAttribute('data-tone')).toBe('danger');
  });

  it('does not show 录制中 when manualRecording is false', () => {
    renderCard(makeStudent({ manualRecording: false }));
    expect(screen.queryByText('录制中')).toBeNull();
  });

  it('does not show 录制中 when manualRecording is omitted', () => {
    renderCard(makeStudent());
    expect(screen.queryByText('录制中')).toBeNull();
  });

  it('shows 录制中 for a locked student who is manually recording', () => {
    renderCard(makeStudent({ manualRecording: true, status: 'locked' }));
    const badge = screen.getByText('录制中');
    expect(badge.getAttribute('data-tone')).toBe('danger');
  });

  it('renders a status dot on the 录制中 badge', () => {
    renderCard(makeStudent({ manualRecording: true }));
    const badge = screen.getByText('录制中');
    expect(badge.querySelector('span')).not.toBeNull();
  });
});

describe('student detail sheet manual recording', () => {
  beforeEach(() => {
    bootstrapUser.id = 7;
    bootstrapUser.name = 'T';
    setManualRecording.mockReset();
    setManualRecording.mockResolvedValue({ ok: true, recording: false });
    listStudentEvents.mockReset();
    listStudentEvents.mockResolvedValue([]);
  });

  it('no longer disables playback or download solely because recordEnabled is false', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/pages/vigil/student-detail-sheet.tsx'), 'utf8');
    expect(source.includes('disabled={!recordEnabled}')).toBe(false);
  });

  it('keeps 录屏回放 and 打包下载录像 enabled when the contest is not recording', () => {
    renderSheet(makeStudent({ manualRecording: false }), false);
    expect(screen.getByRole('button', { name: '录屏回放' }).hasAttribute('disabled')).toBe(false);
    expect(screen.getByRole('button', { name: '打包下载录像' }).hasAttribute('disabled')).toBe(false);
  });

  it('marks 录屏 started when the contest records or this session is manually recording', () => {
    const contestRecording = renderSheet(makeStudent({ manualRecording: false }), true);
    expect(screenLabelText()).toBe('录屏ON');
    contestRecording.unmount();

    renderSheet(makeStudent({ manualRecording: true }), false);
    expect(screenLabelText()).toBe('录屏ON');
  });

  it('marks 录屏 stopped when neither contest recording nor manual recording is on', () => {
    const stopped = renderSheet(makeStudent({ manualRecording: false }), false);
    expect(screenLabelText()).toBe('录屏OFF');
    stopped.unmount();

    renderSheet(makeStudent(), false);
    expect(screenLabelText()).toBe('录屏OFF');
  });

  it('stops manual recording with the signed-in actor', async () => {
    const user = userEvent.setup();
    renderSheet(makeStudent({ manualRecording: true }), false);
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    await waitFor(() => {
      expect(setManualRecording).toHaveBeenCalledWith(CONTEST_ID, MACHINE_ID, false, ACTOR);
    });
    expect(setManualRecording).toHaveBeenCalledTimes(1);
  });

  it('does not show 停止录制 when manualRecording is false', () => {
    renderSheet(makeStudent({ manualRecording: false }), false);
    expect(screen.queryByRole('button', { name: '停止录制' })).toBeNull();
  });

  it('does not show 停止录制 when manualRecording is omitted', () => {
    renderSheet(makeStudent(), false);
    expect(screen.queryByRole('button', { name: '停止录制' })).toBeNull();
  });

  it('does not show 停止录制 when only the contest is recording', () => {
    renderSheet(makeStudent({ manualRecording: false }), true);
    expect(screen.queryByRole('button', { name: '停止录制' })).toBeNull();
  });

  it('disables 停止录制 while the request is in flight', async () => {
    let resolveRecording: (value: { ok: boolean; recording: boolean }) => void = () => {};
    setManualRecording.mockImplementation(
      () =>
        new Promise((fulfill) => {
          resolveRecording = fulfill;
        }),
    );
    const user = userEvent.setup();
    renderSheet(makeStudent({ manualRecording: true }), false);
    const button = screen.getByRole('button', { name: '停止录制' });
    expect(button.hasAttribute('disabled')).toBe(false);
    await user.click(button);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(true);
    });
    resolveRecording({ ok: true, recording: false });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(false);
    });
  });

  it('shows the existing inline error when stopping recording fails', async () => {
    setManualRecording.mockRejectedValue(new Error('网络中断'));
    const user = userEvent.setup();
    const student = makeStudent({ manualRecording: true });
    const view = renderSheet(student, false, 0);
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    expect(await screen.findByText('停止录制失败：网络中断')).toBeTruthy();
    expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(false);

    const callsBeforeReload = listStudentEvents.mock.calls.length;
    view.rerender(sheetElement(student, false, 1));
    await waitFor(() => {
      expect(listStudentEvents.mock.calls.length).toBeGreaterThan(callsBeforeReload);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText('停止录制失败：网络中断')).toBeTruthy();
    expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(false);
  });

  it('does not disable the next student while the previous stop is still in flight', async () => {
    let fulfillStop: (value: { ok: boolean; recording: boolean }) => void = () => {};
    setManualRecording.mockImplementation(
      () =>
        new Promise((fulfill) => {
          fulfillStop = fulfill;
        }),
    );
    const user = userEvent.setup();
    const first = makeStudent({ manualRecording: true });
    const second = makeStudent({
      manualRecording: true,
      machineId: 'm2',
      examSessionId: 'sess-2',
      uid: 43,
      name: '李四',
      studentId: '20231002',
    });
    const view = renderSheet(first, false);
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(true);
    });
    view.rerender(sheetElement(second, false));
    expect(screen.getByRole('heading', { name: '李四' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(false);
    fulfillStop({ ok: true, recording: false });
  });

  it('keeps the first student disabled after another student stop finishes', async () => {
    const pending: Array<(value: { ok: boolean; recording: boolean }) => void> = [];
    setManualRecording.mockImplementation(
      () =>
        new Promise((fulfill) => {
          pending.push(fulfill);
        }),
    );
    const user = userEvent.setup();
    const first = makeStudent({ manualRecording: true });
    const second = makeStudent({
      manualRecording: true,
      machineId: 'm2',
      examSessionId: 'sess-2',
      uid: 43,
      name: '李四',
      studentId: '20231002',
    });
    const view = renderSheet(first, false);
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    await waitFor(() => {
      expect(pending).toHaveLength(1);
    });
    view.rerender(sheetElement(second, false));
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await act(async () => {
      pending[1]?.({ ok: true, recording: false });
      await Promise.resolve();
    });
    view.rerender(sheetElement(first, false));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '张三' })).toBeTruthy();
      expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(true);
    });
    await act(async () => {
      pending[0]?.({ ok: true, recording: false });
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(false);
    });
    expect(screen.queryByText(/停止录制失败/)).toBeNull();
  });

  it('ignores a late stop result after a newer attempt for the same student', async () => {
    const pending: Array<{
      fulfill: (value: { ok: boolean; recording: boolean }) => void;
      reject: (reason?: unknown) => void;
    }> = [];
    setManualRecording.mockImplementation(
      () =>
        new Promise((fulfill, reject) => {
          pending.push({ fulfill, reject });
        }),
    );
    renderSheet(makeStudent({ manualRecording: true }), false);
    const button = screen.getByRole('button', { name: '停止录制' });
    await act(async () => {
      button.click();
      button.click();
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
      expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(true);
    });

    await act(async () => {
      pending[1]?.reject(new Error('网络中断'));
      await Promise.resolve();
    });
    expect(await screen.findByText('停止录制失败：网络中断')).toBeTruthy();
    await act(async () => {
      pending[0]?.fulfill({ ok: true, recording: false });
      await Promise.resolve();
    });
    expect(screen.getByText('停止录制失败：网络中断')).toBeTruthy();

    pending.length = 0;
    await act(async () => {
      screen.getByRole('button', { name: '停止录制' }).click();
      screen.getByRole('button', { name: '停止录制' }).click();
    });
    await waitFor(() => {
      expect(pending).toHaveLength(2);
    });
    await act(async () => {
      pending[1]?.fulfill({ ok: true, recording: false });
      await Promise.resolve();
    });
    expect(screen.queryByText('停止录制失败：网络中断')).toBeNull();
    await act(async () => {
      pending[0]?.reject(new Error('网络中断'));
      await Promise.resolve();
    });
    expect(screen.queryByText('停止录制失败：网络中断')).toBeNull();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(false);
    });
  });

  it('does not paint a failed stop onto the student shown after the request was sent', async () => {
    let rejectStop: (reason?: unknown) => void = () => {};
    setManualRecording.mockImplementation(
      () =>
        new Promise((_fulfill, rejectStopRequest) => {
          rejectStop = rejectStopRequest;
        }),
    );
    const user = userEvent.setup();
    const first = makeStudent({ manualRecording: true });
    const second = makeStudent({
      manualRecording: true,
      machineId: 'm2',
      examSessionId: 'sess-2',
      uid: 43,
      name: '李四',
      studentId: '20231002',
    });
    const view = renderSheet(first, false);
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    await waitFor(() => {
      expect(setManualRecording).toHaveBeenCalledWith(CONTEST_ID, MACHINE_ID, false, ACTOR);
    });
    view.rerender(sheetElement(second, false));
    expect(screen.getByRole('heading', { name: '李四' })).toBeTruthy();
    await act(async () => {
      rejectStop(new Error('网络中断'));
      await Promise.resolve();
    });
    expect(screen.queryByText('停止录制失败：网络中断')).toBeNull();
    expect(screen.getByRole('button', { name: '停止录制' }).hasAttribute('disabled')).toBe(false);
    expect(setManualRecording).toHaveBeenCalledTimes(1);
  });

  it('clears a previous stop failure after the next attempt succeeds', async () => {
    setManualRecording.mockRejectedValueOnce(new Error('网络中断'));
    const user = userEvent.setup();
    renderSheet(makeStudent({ manualRecording: true }), false);
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    expect(await screen.findByText('停止录制失败：网络中断')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    await waitFor(() => {
      expect(screen.queryByText('停止录制失败：网络中断')).toBeNull();
    });
    expect(setManualRecording).toHaveBeenCalledTimes(2);
  });

  it('stops manual recording as whichever user is currently signed in', async () => {
    bootstrapUser.id = 11;
    bootstrapUser.name = '李老师';
    const user = userEvent.setup();
    renderSheet(makeStudent({ manualRecording: true }), false);
    await user.click(screen.getByRole('button', { name: '停止录制' }));
    await waitFor(() => {
      expect(setManualRecording).toHaveBeenCalledWith(CONTEST_ID, MACHINE_ID, false, {
        uid: 11,
        displayName: '李老师',
      });
    });
  });
});
