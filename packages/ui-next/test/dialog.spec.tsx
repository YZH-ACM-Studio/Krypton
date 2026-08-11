import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog, DialogContent, DialogTitle } from '../src/components/ui/dialog';

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
});
