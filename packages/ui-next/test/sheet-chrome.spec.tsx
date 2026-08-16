import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Sheet, SheetBody, SheetContent, SheetHeader, SheetTitle } from '../src/components/ui/sheet';

function FilterSheet({ startOpen = true }: { startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        打开筛选
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom">
          <SheetHeader>
            <SheetTitle>筛选题库</SheetTitle>
          </SheetHeader>
          <SheetBody>
            <button type="button">应用筛选</button>
          </SheetBody>
        </SheetContent>
      </Sheet>
    </div>
  );
}

/** Overlay is the previous sibling of the panel wrapper, not a Tailwind class. */
function getSheetOverlay(dialog: HTMLElement): HTMLElement {
  const overlay = dialog.parentElement?.previousElementSibling;
  if (!(overlay instanceof HTMLElement)) throw new Error('Sheet overlay is missing');
  return overlay;
}

describe('unified Sheet chrome', () => {
  it('renders the consumer title when open', () => {
    render(<FilterSheet />);
    expect(screen.getByRole('dialog', { name: '筛选题库' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '筛选题库' })).toBeInTheDocument();
  });

  it('closes when the overlay is clicked', async () => {
    const user = userEvent.setup();
    render(<FilterSheet />);
    const dialog = screen.getByRole('dialog', { name: '筛选题库' });
    await user.click(getSheetOverlay(dialog));
    expect(screen.queryByRole('dialog', { name: '筛选题库' })).not.toBeInTheDocument();
  });

  it('closes when Escape is pressed', async () => {
    const user = userEvent.setup();
    render(<FilterSheet />);
    expect(screen.getByRole('dialog', { name: '筛选题库' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: '筛选题库' })).not.toBeInTheDocument();
  });

  it('closes when the 关闭 button is clicked', async () => {
    const user = userEvent.setup();
    render(<FilterSheet />);
    await user.click(screen.getByRole('button', { name: '关闭' }));
    expect(screen.queryByRole('dialog', { name: '筛选题库' })).not.toBeInTheDocument();
  });

  it('makes SheetBody the scroll owner instead of SheetContent', () => {
    render(<FilterSheet />);
    const content = screen.getByRole('dialog', { name: '筛选题库' });
    expect(content.querySelector('[data-scroll-owner="sheet"]')).not.toBeNull();
    expect(content).not.toHaveAttribute('data-scroll-owner');
    expect(content).not.toHaveClass('overflow-y-auto');
  });
});
