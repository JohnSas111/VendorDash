// lib/scanFeedback.ts
//
// What the organizer sees after scanning a vendor's QR code at check-in.
// At a busy gate the result has to be readable at a glance: a short title,
// the BUSINESS name big, and the person / stall / days underneath so staff
// can compare it with who is standing in front of them.

import { ownerPrefix } from "@/lib/uxHelpers";

export type ScanFeedback = {
  type: "success" | "error";
  title: string; // "Checked in", "Already checked in", "Can't check in", ...
  name: string | null; // business name, when the booking is known
  detail: string; // "Johnny · Stall A1 · Fri, Sat, Sun" or an explanation
};

export type ScanRow = {
  vendor_name: string;
  owner_name: string;
  stall_number: string;
  days: string[]; // "friday" | "saturday" | "sunday"
};

const WEEK: { key: string; label: string }[] = [
  { key: "friday", label: "Fri" },
  { key: "saturday", label: "Sat" },
  { key: "sunday", label: "Sun" },
];

// "Fri, Sun" in week order; unknown values are ignored.
export function daysLabel(days: string[]): string {
  return WEEK.filter((d) => days.includes(d.key))
    .map((d) => d.label)
    .join(", ");
}

// "Johnny · Stall A1 · Fri, Sat, Sun" (parts that add nothing are left out)
export function rowSummary(row: ScanRow): string {
  const days = daysLabel(row.days);
  return (
    `${ownerPrefix(row.vendor_name, row.owner_name)}Stall ${row.stall_number}` +
    (days ? ` · ${days}` : "")
  );
}

export function scanSuccess(row: ScanRow): ScanFeedback {
  return {
    type: "success",
    title: "Checked in",
    name: row.vendor_name,
    detail: rowSummary(row),
  };
}

export function scanAlready(row: ScanRow, status: string): ScanFeedback {
  return {
    type: "error",
    title: status === "completed" ? "Already completed" : "Already checked in",
    name: row.vendor_name,
    detail: rowSummary(row),
  };
}

export function scanUnknown(): ScanFeedback {
  return {
    type: "error",
    title: "QR not recognised",
    name: null,
    detail:
      "It doesn't match a paid booking for the selected session. Check that the right session is selected above.",
  };
}

export function scanFailed(row: ScanRow, serverMessage: string): ScanFeedback {
  return {
    type: "error",
    title: "Can't check in",
    name: row.vendor_name,
    detail: `${rowSummary(row)} — ${serverMessage}`,
  };
}
