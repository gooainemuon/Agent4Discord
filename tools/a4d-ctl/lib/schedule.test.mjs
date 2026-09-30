import { describe, expect, it } from 'vitest';
import { decide, inWindow, parseDays, stopDays, nextOccurrence } from './schedule.mjs';

// 2026-10-01 is a Thursday.
const local = (d, h, m) => new Date(2026, 9, d, h, m);
const weekdays = { start: '09:00', stop: '18:00', days: [1, 2, 3, 4, 5] };
const overnight = { start: '22:00', stop: '06:00', days: [1, 2, 3, 4, 5, 6, 0] };

describe('parseDays', () => {
  it('parses presets, lists and ranges', () => {
    expect(parseDays('weekdays')).toEqual([1, 2, 3, 4, 5]);
    expect(parseDays('mon,wed,fri')).toEqual([1, 3, 5]);
    expect(parseDays('fri-mon')).toEqual([0, 1, 5, 6]);
    expect(() => parseDays('xyz')).toThrow();
  });
});

describe('inWindow', () => {
  it('handles normal windows', () => {
    expect(inWindow(local(1, 10, 0), weekdays)).toBe(true);
    expect(inWindow(local(1, 18, 0), weekdays)).toBe(false);
    expect(inWindow(local(3, 10, 0), weekdays)).toBe(false); // Saturday
  });
  it('handles overnight windows', () => {
    expect(inWindow(local(1, 23, 0), overnight)).toBe(true);
    expect(inWindow(local(2, 5, 59), overnight)).toBe(true);
    expect(inWindow(local(2, 6, 0), overnight)).toBe(false);
  });
});

describe('decide', () => {
  it('starts on time', () => {
    expect(decide('start', local(1, 9, 2), weekdays, 5).action).toBe('start');
  });
  it('starts late when still inside the window', () => {
    expect(decide('start', local(1, 10, 30), weekdays, 5).action).toBe('start-late');
  });
  it('skips a missed start once the window is over', () => {
    expect(decide('start', local(1, 20, 0), weekdays, 5).action).toBe('skip');
  });
  it('stops on time and flags a missed stop', () => {
    expect(decide('stop', local(1, 18, 1), weekdays, 5).action).toBe('stop');
    expect(decide('stop', local(1, 20, 0), weekdays, 5).action).toBe('stop-missed');
  });
  it('uses the next day for overnight stops', () => {
    expect(stopDays({ ...overnight, days: [5] })).toEqual([6]);
    expect(decide('stop', local(3, 6, 0), { ...overnight, days: [5] }, 5).action).toBe('stop');
  });
});

describe('nextOccurrence', () => {
  it('skips to the next scheduled day', () => {
    expect(nextOccurrence(local(2, 19, 0), '09:00', [1, 2, 3, 4, 5])).toEqual(local(5, 9, 0)); // Fri → Mon
  });
});
