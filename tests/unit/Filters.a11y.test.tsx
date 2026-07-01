import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '../i18n-render.tsx';
import userEvent from '@testing-library/user-event';
import { Filters } from '../../src/components/Filters.tsx';
import { checkA11y } from '../axe.ts';

describe('Filters', () => {
  it('has no accessibility violations', async () => {
    const { container } = render(
      <Filters value={{}} onChange={vi.fn()} resultCount={3} />,
    );
    await checkA11y(container);
  });

  it('toggles a category filter on selection', async () => {
    const onChange = vi.fn();
    render(<Filters value={{}} onChange={onChange} resultCount={0} />);
    await userEvent.click(screen.getByText('Pothole'));
    expect(onChange).toHaveBeenCalledWith({ categories: ['pothole'] });
  });

  it('announces the result count', () => {
    render(<Filters value={{}} onChange={vi.fn()} resultCount={5} />);
    expect(screen.getByText('5 hazards shown')).toBeInTheDocument();
  });
});
