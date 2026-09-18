// @vitest-environment jsdom
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import {
  alertDialog,
  confirmDialog,
  confirmFormSubmit,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHost,
  DialogTitle,
  promptDialog,
} from '../src/components/ui/dialog';
import { TeamDialogBody, TeamDialogContent, TeamDialogFooter } from '../src/components/team-dialog';

function DialogPair({ outerOpen, innerOpen }: { outerOpen: boolean; innerOpen: boolean }) {
  return (
    <>
      <button type="button">背景操作</button>
      <Dialog open={outerOpen} onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogTitle>外层弹窗</DialogTitle>
          <button type="button">外层操作</button>
        </DialogContent>
      </Dialog>
      <Dialog open={innerOpen} onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogTitle>内层弹窗</DialogTitle>
          <button type="button">内层操作</button>
        </DialogContent>
      </Dialog>
    </>
  );
}

describe('dialog modal environment', () => {
  it('keeps the remaining modal isolated when a lower dialog closes first', () => {
    const { container, rerender } = render(<DialogPair outerOpen innerOpen />);

    const outerRoot = screen.getByText('外层弹窗').closest('[data-krypton-dialog-root="true"]');
    const innerRoot = screen.getByText('内层弹窗').closest('[data-krypton-dialog-root="true"]');
    expect(screen.getByRole('dialog', { name: '内层弹窗' })).toBeInTheDocument();
    expect(container).toHaveAttribute('inert');
    expect(outerRoot).toHaveAttribute('inert');
    expect(innerRoot).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<DialogPair outerOpen={false} innerOpen />);
    expect(screen.getByRole('dialog', { name: '内层弹窗' })).toBeInTheDocument();
    expect(container).toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('hidden');

    rerender(<DialogPair outerOpen={false} innerOpen={false} />);
    expect(container).not.toHaveAttribute('inert');
    expect(document.body.style.overflow).toBe('');
  });

  it('restores the background focus after a lower dialog closes before the topmost dialog', () => {
    const { rerender } = render(<DialogPair outerOpen={false} innerOpen={false} />);
    const backgroundButton = screen.getByRole('button', { name: '背景操作' });
    backgroundButton.focus();

    rerender(<DialogPair outerOpen innerOpen={false} />);
    const outerButton = screen.getByRole('button', { name: '外层操作' });
    outerButton.focus();

    rerender(<DialogPair outerOpen innerOpen />);
    expect(screen.getByRole('button', { name: '内层操作' })).toHaveFocus();

    rerender(<DialogPair outerOpen={false} innerOpen />);
    rerender(<DialogPair outerOpen={false} innerOpen={false} />);

    expect(backgroundButton).toHaveFocus();
  });

  it('keeps chrome pinned when a form is a sibling of the header', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogTitle>表单确认</DialogTitle>
          <form>
            <p>正文</p>
            <DialogFooter>
              <button type="submit">提交</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: '表单确认' });
    const form = dialog.querySelector('form');
    const body = dialog.querySelector('[data-scroll-owner="dialog"]');
    expect(form).not.to.equal(null);
    expect(body).not.to.equal(null);
    expect(form?.contains(screen.getByText('表单确认'))).to.equal(true);
    expect(body?.textContent).to.include('正文');
    expect(body?.contains(screen.getByRole('button', { name: '提交' }))).to.equal(false);
  });

  it('keeps chrome pinned when a form is the only DialogContent child', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <form>
            <DialogTitle>唯一表单</DialogTitle>
            <p>正文</p>
            <DialogFooter>
              <button type="submit">提交</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: '唯一表单' });
    const form = dialog.querySelector('form');
    const body = dialog.querySelector('[data-scroll-owner="dialog"]');
    expect(form).not.to.equal(null);
    expect(body).not.to.equal(null);
    expect(form?.contains(screen.getByText('唯一表单'))).to.equal(true);
    expect(body?.textContent).to.include('正文');
    expect(body?.contains(screen.getByRole('button', { name: '提交' }))).to.equal(false);
  });

  it('pins header and footer and scrolls the body when content overflows', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent>
          <DialogTitle>长内容</DialogTitle>
          <p>正文</p>
          <DialogFooter>
            <button type="button">底部确认</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: '长内容' });
    const body = dialog.querySelector('[data-scroll-owner="dialog"]');
    const footer = dialog.querySelector('[data-slot="dialog-footer"]');
    expect(body).not.to.equal(null);
    expect(body?.textContent).to.include('正文');
    expect(body?.className).to.include('overflow-y-auto');
    expect(body?.className).to.include('min-h-0');
    expect(body?.className).to.include('flex-1');
    expect(footer?.className).to.include('shrink-0');
    expect(body?.contains(screen.getByRole('button', { name: '底部确认' }))).to.equal(false);
  });

  it('keeps TeamDialog wrapper slots pinned and names the dialog from the title', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <TeamDialogContent
          titleId="create-self-dialog-title"
          descriptionId="create-self-dialog-description"
          title="组队确认"
          description="确认后将立即执行此操作。"
          icon={<span />}
          onClose={vi.fn()}
        >
          <form>
            <TeamDialogBody>
              <p>正文</p>
            </TeamDialogBody>
            <TeamDialogFooter>
              <button type="button">取消</button>
              <button type="submit">确认</button>
            </TeamDialogFooter>
          </form>
        </TeamDialogContent>
      </Dialog>,
    );

    const dialog = screen.getByRole('dialog', { name: '组队确认' });
    const body = dialog.querySelector('[data-scroll-owner="dialog"]');
    expect(dialog).toHaveAccessibleDescription('确认后将立即执行此操作。');
    expect(body?.textContent).to.include('正文');
    expect(body?.contains(screen.getByRole('button', { name: '确认' }))).to.equal(false);
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus();
    expect(screen.getByRole('button', { name: '关闭弹窗' })).not.toHaveFocus();
  });

  it('keeps the accessible name when callers pass a custom labelledby id', () => {
    render(
      <Dialog open onOpenChange={vi.fn()}>
        <DialogContent aria-labelledby="add-domain-users-dialog-title">
          <DialogTitle id="add-domain-users-dialog-title">添加或更新域用户</DialogTitle>
          <p>正文</p>
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByRole('dialog', { name: '添加或更新域用户' })).toBeInTheDocument();
  });
});

describe('dialog command host', () => {
  async function mountHost() {
    render(<DialogHost />);
    await act(async () => {
      await Promise.resolve();
    });
  }

  it('fails fast when the host is not mounted', () => {
    expect(() => {
      void confirmDialog('未挂载');
    }).toThrow(/DialogHost is not mounted/);
  });

  it('resolves confirm, alert and prompt through the same dialog', async () => {
    const user = userEvent.setup();
    await mountHost();

    const confirmed = confirmDialog('确定删除？', { destructive: true, confirmLabel: '删除' });
    expect(await screen.findByRole('dialog', { name: '确认' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '删除' }));
    expect(await confirmed).to.equal(true);

    const cancelled = confirmDialog('再问一次');
    await screen.findByRole('dialog', { name: '确认' });
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await cancelled).to.equal(false);

    const alerted = alertDialog('已保存');
    await screen.findByRole('dialog', { name: '提示' });
    await user.click(screen.getByRole('button', { name: '知道了' }));
    await alerted;

    const prompted = promptDialog('驳回理由（必填）：', { defaultValue: '' });
    await screen.findByRole('dialog', { name: '输入' });
    await user.type(screen.getByRole('textbox'), '重复绑定');
    await user.click(screen.getByRole('button', { name: '确定' }));
    expect(await prompted).to.equal('重复绑定');

    const promptCancelled = promptDialog('再输入一次');
    await screen.findByRole('dialog', { name: '输入' });
    await user.click(screen.getByRole('button', { name: '取消' }));
    expect(await promptCancelled).to.equal(null);
  });

  it('submits the original form only after confirm', async () => {
    const user = userEvent.setup();
    const submitted = vi.fn();
    render(
      <>
        <DialogHost />
        <form
          onSubmit={(event) => {
            void confirmFormSubmit(event, '确定要重启服务吗？');
          }}
        >
          <button type="submit">重启服务</button>
        </form>
      </>,
    );
    await act(async () => {
      await Promise.resolve();
    });
    const form = screen.getByRole('button', { name: '重启服务' }).closest('form');
    if (!form) throw new Error('missing form');
    form.submit = submitted;

    await user.click(screen.getByRole('button', { name: '重启服务' }));
    expect(submitted).not.toHaveBeenCalled();
    await user.click(await screen.findByRole('button', { name: '取消' }));
    expect(submitted).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '重启服务' }));
    await user.click(await screen.findByRole('button', { name: '确认' }));
    expect(submitted).toHaveBeenCalledTimes(1);
  });
});
