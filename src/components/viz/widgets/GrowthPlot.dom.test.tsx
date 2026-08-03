// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { GrowthPlot } from './GrowthPlot.tsx';

/**
 * The teaching claim this widget makes is falsifiable: "with constant factor c,
 * the O(n²) algorithm is genuinely faster below n = X". These tests check the
 * number in that sentence is actually the crossover point, and that moving the
 * sliders moves it in the right direction.
 */

const caption = () => document.querySelector('.viz-frame__caption')!.textContent!;
const crossoverFromCaption = () => {
  const match = /below (\d+)/.exec(caption());
  return match ? Number(match[1]) : null;
};
const sliders = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '.growth-plot__controls input[type="range"]',
    ),
  );

describe('GrowthPlot', () => {
  it('draws every curve', () => {
    render(<GrowthPlot />);
    expect(document.querySelectorAll('.growth-plot__curve')).toHaveLength(4);
    for (const path of document.querySelectorAll('.growth-plot__curve')) {
      expect(path.getAttribute('d')!.length).toBeGreaterThan(100);
    }
  });

  it('reports a crossover that really is the crossover', () => {
    render(<GrowthPlot />);
    const n = crossoverFromCaption()!;
    const c = 12; // the default

    // Just below it, c·n log n must still be cheaper; at it, n² must have won.
    const below = n - 1;
    expect(below * below).toBeLessThanOrEqual(c * below * Math.log2(below));
    expect(n * n).toBeGreaterThan(c * n * Math.log2(n));
  });

  it('raising the constant factor pushes the crossover later', () => {
    render(<GrowthPlot />);
    const before = crossoverFromCaption()!;

    const [, constant] = sliders();
    fireEvent.change(constant!, { target: { value: '40' } });

    const after = crossoverFromCaption()!;
    expect(after).toBeGreaterThan(before);
    expect(caption()).toContain('c = 40');
  });

  it('changing n updates the step counts shown', () => {
    render(<GrowthPlot />);
    const [maxN] = sliders();

    fireEvent.change(maxN!, { target: { value: '1000' } });

    const counters = document.querySelector('.viz-counters')!.textContent!;
    expect(counters).toContain('at n = 1000');
    // n² at n=1000 is a million, and it should be rendered readably.
    expect(counters).toContain('1,000,000');
  });

  it('offers a log-scale toggle', () => {
    render(<GrowthPlot />);
    const toggle = screen.getByLabelText('log scale', { exact: false });
    const before = document.querySelector('.growth-plot__curve')!.getAttribute('d');

    fireEvent.click(toggle);

    expect(document.querySelector('.growth-plot__curve')!.getAttribute('d')).not.toBe(
      before,
    );
  });
});
