// hooks/usePaging.ts
//
// Keeps the current page of a list. Pass a `resetKey` made from whatever
// should send the list back to page 1 (the filter and the search text).

import { clampPage, PAGE_SIZE, pageSlice } from "@/lib/paging";
import { useState } from "react";

export function usePaging<T>(
  items: readonly T[],
  resetKey: string,
  size: number = PAGE_SIZE,
) {
  const [state, setState] = useState({ key: resetKey, page: 1 });
  // A changed key means "start again": no effect needed, the old page is
  // simply ignored until the user picks a new one.
  const wanted = state.key === resetKey ? state.page : 1;
  const page = clampPage(wanted, items.length, size);
  return {
    page,
    pageItems: pageSlice(items, page, size),
    setPage: (p: number) => setState({ key: resetKey, page: p }),
    total: items.length,
    size,
  };
}
