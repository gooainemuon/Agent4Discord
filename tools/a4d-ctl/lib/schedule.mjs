// Pure schedule logic (local time). Days use JS numbering: 0 = Sunday … 6 = Saturday.

const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_LABELS_KO = ['일', '월', '화', '수', '목', '금', '토'];
const MINUTE = 60_000;

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Parse "HH:MM" into { h, m }, or throw. */
export function parseTime(text) {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(text).trim());
  if (!match) throw new Error(`시간 형식이 잘못됐어요 (HH:MM): ${text}`);
  return { h: Number(match[1]), m: Number(match[2]) };
}

/** Parse "all" | "weekdays" | "weekends" | "mon,wed,fri" | "mon-fri" into sorted day numbers. */
export function parseDays(text) {
  const t = String(text).trim().toLowerCase();
  if (t === 'all' || t === 'daily' || t === '매일') return [...ALL_DAYS];
  if (t === 'weekdays' || t === '평일') return [1, 2, 3, 4, 5];
  if (t === 'weekends' || t === '주말') return [0, 6];
  const days = new Set();
  for (const part of t.split(',').map((p) => p.trim()).filter(Boolean)) {
    const range = part.split('-');
    const idx = range.map((name) => DAY_NAMES.indexOf(name.slice(0, 3)));
    if (idx.some((i) => i < 0) || idx.length > 2) throw new Error(`요일 형식이 잘못됐어요: ${part}`);
    if (idx.length === 1) days.add(idx[0]);
    else for (let d = idx[0]; ; d = (d + 1) % 7) { days.add(d); if (d === idx[1]) break; }
  }
  if (days.size === 0) throw new Error('요일을 하나 이상 지정하세요');
  return [...days].sort((a, b) => a - b);
}

export function describeDays(days) {
  const key = [...days].sort((a, b) => a - b).join(',');
  if (key === '0,1,2,3,4,5,6') return '매일';
  if (key === '1,2,3,4,5') return '평일';
  if (key === '0,6') return '주말';
  return days.map((d) => DAY_LABELS_KO[d]).join(',');
}

function at(base, dayOffset, { h, m }) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + dayOffset, h, m, 0, 0);
  return d;
}

/** True when the stop time is on the day after the start (e.g. 22:00 → 06:00). */
export function isOvernight(schedule) {
  const s = parseTime(schedule.start);
  const e = parseTime(schedule.stop);
  return e.h * 60 + e.m <= s.h * 60 + s.m;
}

/** Days on which the stop event fires (shifted by one for overnight windows). */
export function stopDays(schedule) {
  const shift = isOvernight(schedule) ? 1 : 0;
  return schedule.days.map((d) => (d + shift) % 7).sort((a, b) => a - b);
}

/** Most recent occurrence of `time` on one of `days` at or before `now`. */
export function lastOccurrence(now, time, days) {
  const t = parseTime(time);
  for (let offset = 0; offset >= -7; offset--) {
    const d = at(now, offset, t);
    if (d <= now && days.includes(d.getDay())) return d;
  }
  return null;
}

/** Next occurrence of `time` on one of `days` strictly after `now`. */
export function nextOccurrence(now, time, days) {
  const t = parseTime(time);
  for (let offset = 0; offset <= 7; offset++) {
    const d = at(now, offset, t);
    if (d > now && days.includes(d.getDay())) return d;
  }
  return null;
}

/** Whether `now` falls inside an on-window (start ≤ now < stop). */
export function inWindow(now, schedule) {
  const s = parseTime(schedule.start);
  const e = parseTime(schedule.stop);
  const overnight = isOvernight(schedule);
  for (const offset of [0, -1]) {
    const start = at(now, offset, s);
    if (!schedule.days.includes(start.getDay())) continue;
    const stop = at(now, offset + (overnight ? 1 : 0), e);
    if (start <= now && now < stop) return true;
  }
  return false;
}

/**
 * Decide what a fired schedule trigger should do.
 * - start on time            → 'start'
 * - start late, inside window → 'start-late' (start + notify)
 * - start late, window over   → 'skip'
 * - stop on time             → 'stop'
 * - stop late                → 'stop-missed' (don't stop; ask the user)
 */
export function decide(kind, now, schedule, missedThresholdMinutes) {
  const time = kind === 'start' ? schedule.start : schedule.stop;
  const days = kind === 'start' ? schedule.days : stopDays(schedule);
  const expected = lastOccurrence(now, time, days);
  const lateMs = expected ? now - expected : Infinity;
  const onTime = lateMs <= missedThresholdMinutes * MINUTE;

  if (kind === 'start') {
    if (onTime) return { action: 'start', expected };
    return { action: inWindow(now, schedule) ? 'start-late' : 'skip', expected };
  }
  return { action: onTime ? 'stop' : 'stop-missed', expected };
}
