// lib/paging.ts
//
// Pure helpers for "page 1 2 3 … Next" lists. No React and no database: the
// organizer screens load their rows once and show PAGE_SIZE of them at a time.

export const PAGE_SIZE = 10;

export function pageCount(total: number, size: number = PAGE_SIZE): number {
  if (!Number.isFinite(total) || total <= 0 || size <= 0) return 1;
  return Math.ceil(total / size);
}

// A page number that exists: 1..pageCount. Anything else (0, 99, NaN) is
// pulled back into range, so a list that shrinks never shows an empty page.
export function clampPage(
  page: number,
  total: number,
  size: number = PAGE_SIZE,
): number {
  const last = pageCount(total, size);
  if (!Number.isFinite(page)) return 1;
  return Math.min(Math.max(Math.trunc(page), 1), last);
}

export function pageSlice<T>(
  items: readonly T[],
  page: number,
  size: number = PAGE_SIZE,
): T[] {
  const p = clampPage(page, items.length, size);
  return items.slice((p - 1) * size, p * size);
}

// "Showing 11–20 of 24 stalls"
export function rangeLabel(
  page: number,
  total: number,
  noun: string,
  size: number = PAGE_SIZE,
): string {
  if (total <= 0) return `No ${noun}`;
  const p = clampPage(page, total, size);
  const from = (p - 1) * size + 1;
  const to = Math.min(p * size, total);
  return `Showing ${from}–${to} of ${total} ${noun}`;
}

export type PageItem = number | "gap";

// The numbers to draw: all of them when there are few, otherwise the first,
// the last and the neighbours of the current page, with "gap" for the
// skipped stretches: 1 gap 4 5 6 gap 12.
export function pageNumbers(page: number, last: number): PageItem[] {
  if (last <= 7) return Array.from({ length: last }, (_, i) => i + 1);
  const p = Math.min(Math.max(page, 1), last);
  const keep = new Set<number>([1, last, p - 1, p, p + 1]);
  if (p <= 3) [2, 3, 4].forEach((n) => keep.add(n));
  if (p >= last - 2) [last - 3, last - 2, last - 1].forEach((n) => keep.add(n));
  const sorted = [...keep]
    .filter((n) => n >= 1 && n <= last)
    .sort((a, b) => a - b);
  const out: PageItem[] = [];
  sorted.forEach((n, i) => {
    const prev = sorted[i - 1];
    // A gap that would hide a single page just shows that page instead.
    if (i > 0 && n - prev === 2) out.push(prev + 1);
    else if (i > 0 && n - prev > 2) out.push("gap");
    out.push(n);
  });
  return out;
}
