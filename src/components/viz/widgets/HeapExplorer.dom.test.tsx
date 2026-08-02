// @vitest-environment jsdom
import { describe, expect, it, beforeAll } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { HeapExplorer } from './HeapExplorer.tsx';

/**
 * The trace tests prove the algorithm is right. These prove the widget is wired
 * to it: that pressing a button actually runs a trace, that stepping moves
 * through it, and that both views stay in sync.
 */

beforeAll(() => {
  // jsdom has no layout engine; motion's layout animations need this stub.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
  }
});

const stepCounter = () => screen.getByText(/^step \d+ \/ \d+$/).textContent!;
const arrayValues = () =>
  Array.from(document.querySelectorAll('.viz-array .viz-cell')).map(
    (el) => el.textContent,
  );

describe('HeapExplorer', () => {
  it('renders the initial heap in both views', () => {
    render(<HeapExplorer initial={[1, 3, 6, 5, 9, 8]} />);

    expect(arrayValues()).toEqual(['1', '3', '6', '5', '9', '8']);
    expect(document.querySelectorAll('.viz-node')).toHaveLength(6);
    // A 6-node complete tree has 5 parent→child edges.
    expect(document.querySelectorAll('.viz-edge')).toHaveLength(5);
  });

  it('runs a real trace when insert is pressed', () => {
    render(<HeapExplorer initial={[1, 3, 6, 5, 9, 8]} />);
    expect(stepCounter()).toBe('step 1 / 1'); // idle

    fireEvent.click(screen.getByRole('button', { name: 'insert' }));

    // The idle single-frame view has been replaced by a multi-step trace.
    expect(stepCounter()).toMatch(/^step 1 \/ ([2-9]|\d\d)/);
    expect(arrayValues()).toHaveLength(7);
  });

  it('stepping forward advances the trace and moves the highlighted code line', () => {
    render(<HeapExplorer initial={[1, 3, 6, 5, 9, 8]} />);
    fireEvent.click(screen.getByRole('button', { name: 'insert' }));

    const firstLine = document.querySelector(
      '.viz-code__line[data-active]',
    )?.textContent;
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));

    expect(stepCounter()).toMatch(/^step 2 \//);
    expect(
      document.querySelector('.viz-code__line[data-active]')?.textContent,
    ).not.toBe(firstLine);
  });

  it('sifts a new minimum to the root by the end of the trace', () => {
    render(<HeapExplorer initial={[1, 3, 6, 5, 9, 8]} />);

    fireEvent.change(screen.getByLabelText('Value to insert'), {
      target: { value: '0' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'insert' }));

    // Jump to the end rather than waiting out the animation.
    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: scrubber.max } });

    expect(arrayValues()[0]).toBe('0');
  });

  it('extract min removes the root and leaves the views consistent', () => {
    render(<HeapExplorer initial={[1, 3, 6, 5, 9, 8]} />);
    fireEvent.click(screen.getByRole('button', { name: 'extract min' }));

    const scrubber = screen.getByLabelText('Scrub through steps') as HTMLInputElement;
    fireEvent.change(scrubber, { target: { value: scrubber.max } });

    const values = arrayValues();
    expect(values).toHaveLength(5);
    expect(values).not.toContain('1');
    // The tree must show exactly what the array holds — no drift between views.
    expect(document.querySelectorAll('.viz-node')).toHaveLength(5);
  });

  it('reset returns to the starting heap', () => {
    render(<HeapExplorer initial={[1, 3, 6, 5, 9, 8]} />);
    fireEvent.click(screen.getByRole('button', { name: 'extract min' }));
    fireEvent.click(screen.getByRole('button', { name: 'reset' }));

    expect(arrayValues()).toEqual(['1', '3', '6', '5', '9', '8']);
    expect(stepCounter()).toBe('step 1 / 1');
  });

  it('offers both languages and switches the code pane between them', () => {
    render(<HeapExplorer initial={[1, 3, 6, 5, 9, 8]} />);
    fireEvent.click(screen.getByRole('button', { name: 'insert' }));

    const code = document.querySelector('.viz-code')!;
    expect(code.textContent).toContain('def sift_up');

    fireEvent.click(
      within(code as HTMLElement).getByRole('tab', { name: 'TypeScript' }),
    );
    expect(code.textContent).toContain('function siftUp');
    expect(code.textContent).not.toContain('def sift_up');
  });
});
