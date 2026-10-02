// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from '../../src/lib/cn.ts';

describe('cn text and shadow scales', () => {
  it('keeps text-md together with text-fg', () => {
    const classes = cn('text-md', 'text-fg').split(/\s+/);
    expect(classes).to.include('text-md');
    expect(classes).to.include('text-fg');
  });

  it('keeps text-2xs together with text-fg-subtle', () => {
    const classes = cn('text-2xs', 'text-fg-subtle').split(/\s+/);
    expect(classes).to.include('text-2xs');
    expect(classes).to.include('text-fg-subtle');
  });

  it('lets a later text size replace an earlier one', () => {
    expect(cn('text-sm', 'text-md')).to.equal('text-md');
  });

  it('lets a later shadow replace an earlier one', () => {
    expect(cn('shadow-xs', 'shadow-pop')).to.equal('shadow-pop');
  });

  it('lets a later background replace an earlier one', () => {
    expect(cn('bg-surface', 'bg-brand')).to.equal('bg-brand');
  });

  it('drops empty values and lets a later padding replace an earlier one', () => {
    expect(cn('px-2', undefined, false, 'px-4')).to.equal('px-4');
  });

  it('keeps a text colour beside a text size in either order', () => {
    expect(cn('text-fg', 'text-md')).to.equal('text-fg text-md');
    expect(cn('text-fg-subtle', 'text-2xs')).to.equal('text-fg-subtle text-2xs');
  });

  it('keeps the brand colour beside a text size', () => {
    expect(cn('text-md', 'text-brand')).to.equal('text-md text-brand');
  });

  it('does not treat a different-cased name as the text-md size', () => {
    expect(cn('text-MD', 'text-lg')).to.equal('text-MD text-lg');
  });

  it('lets shadow-pop replace a built-in shadow without swallowing a shadow colour', () => {
    expect(cn('shadow-sm', 'shadow-pop')).to.equal('shadow-pop');
    expect(cn('shadow-brand', 'shadow-pop')).to.equal('shadow-brand shadow-pop');
  });
});
