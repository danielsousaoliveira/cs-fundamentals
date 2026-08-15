// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { RenderingTimeline } from './RenderingTimeline.tsx';

const caption = () => document.querySelector('.viz-frame__caption')!.textContent!;

describe('RenderingTimeline', () => {
  it('opens on the static strategy with a fast TTFB caption', () => {
    render(<RenderingTimeline />);
    expect(caption()).toContain('Static (SSG)');
  });

  it('switching strategy changes the caption and the rendered event bars', () => {
    render(<RenderingTimeline />);
    const before = caption();
    const beforeEvents = document.querySelectorAll('.rtl__event').length;

    fireEvent.click(screen.getByRole('button', { name: 'Client-rendered (CSR)' }));

    expect(caption()).not.toBe(before);
    expect(caption()).toContain('Client-rendered (CSR)');
    // CSR adds a fetch track the other strategies do not have.
    expect(document.querySelectorAll('.rtl__event').length).toBeGreaterThan(
      beforeEvents,
    );
  });

  it('shows CSR largest contentful paint happening after hydration, flagged as the failure mode', () => {
    render(<RenderingTimeline />);
    fireEvent.click(screen.getByRole('button', { name: 'Client-rendered (CSR)' }));

    const lcpItem = Array.from(document.querySelectorAll('.viz-counters__item')).find(
      (el) => el.textContent?.includes('largest contentful paint'),
    )!;
    expect(lcpItem.querySelector('.viz-counters__value')!.classList).toContain(
      'join__wrong',
    );
  });

  it('marks static LCP well before hydration, with no failure flag', () => {
    render(<RenderingTimeline />);

    const lcpItem = Array.from(document.querySelectorAll('.viz-counters__item')).find(
      (el) => el.textContent?.includes('largest contentful paint'),
    )!;
    expect(lcpItem.querySelector('.viz-counters__value')!.classList).not.toContain(
      'join__wrong',
    );
  });
});
