import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../i18n-render.tsx';
import { PhotoEditor } from '../../src/components/PhotoEditor.tsx';
import { checkA11y } from '../axe.ts';

describe('PhotoEditor', () => {
  it('has no accessibility violations in the picker state', async () => {
    const { container } = render(
      <PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />,
    );
    await checkA11y(container);
  });

  it('explains that privacy processing happens on-device', () => {
    render(<PhotoEditor onComplete={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/on your device/i)).toBeInTheDocument();
  });
});
