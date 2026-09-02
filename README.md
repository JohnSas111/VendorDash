# VendorDash — Final Completion Package

This finishes everything that was still missing from the vendor side:
**file uploads** (business permit + receipt photo), **notifications**, and
**QR check-in**. Organizer side remains excluded, per your earlier decision
— say the word if you want that built too.

---

## Part 1: New packages to install

```bash
npx expo install expo-image-picker expo-file-system
npm install base64-arraybuffer
npx expo install react-native-svg
npm install react-native-qrcode-svg
```

---

## Part 2: Database setup (run once)

Open **Supabase SQL editor**, run the contents of `supabase/storage-setup.sql`
(included in this package). This creates two storage buckets
(`business-permits`, `sales-receipts`) with the correct access policies —
vendors can only upload to their own folder, anyone can view (needed for
displaying thumbnails in the app).

---

## Part 3: Files to ADD or REPLACE

```
lib/upload.ts                                  → NEW

screens/vendor/CompleteProfileScreen.tsx       → REPLACE (real permit upload)
screens/vendor/SalesSubmissionScreen.tsx       → REPLACE (real receipt upload)
screens/vendor/VendorHomeScreen.tsx            → REPLACE (adds notification bell)
screens/vendor/MyBookingsScreen.tsx            → REPLACE (upcoming cards link to QR check-in)
screens/vendor/StallDetailScreen.tsx           → REPLACE (creates a notification on booking)
screens/vendor/NotificationsScreen.tsx         → NEW
screens/vendor/BookingDetailScreen.tsx         → NEW

app/(vendor)/_layout.tsx                       → REPLACE (adds 2 new screens)
app/(vendor)/complete-profile.tsx              → REPLACE (same content, just re-copy to be safe)
app/(vendor)/sales-submission.tsx              → REPLACE
app/(vendor)/home.tsx                          → REPLACE
app/(vendor)/my-bookings.tsx                   → REPLACE
app/(vendor)/stall-detail.tsx                  → REPLACE
app/(vendor)/notifications.tsx                 → NEW
app/(vendor)/booking-detail.tsx                → NEW

supabase/functions/paymongo-webhook/index.ts   → REPLACE (adds payment notification)
```

Extract this zip directly into your project root (contents sit at the top
level, no wrapper folder), let it merge/replace.

---

## Part 4: Redeploy the updated Edge Function

Since `paymongo-webhook` changed (it now also creates a notification), you
need to redeploy it if you already set up PayMongo:

```bash
supabase functions deploy paymongo-webhook
```

If you **haven't** set up PayMongo yet, this step happens naturally as part
of the PayMongo setup guide from the earlier package — no extra action needed
right now.

---

## Part 5: What's now genuinely complete

- **Business permit upload** — real photo picker, uploads to Supabase
  Storage, shows a thumbnail once uploaded, saved to
  `vendor_details.business_permit_url`
- **Receipt photo upload** — same pattern, on the Sales Submission screen
- **Notifications** — a real inbox screen, with unread-count badge on the
  Home bell icon. Two things now actually generate notifications:
  - Submitting a booking → "Booking request submitted"
  - Payment confirming (via the webhook) → "Payment confirmed"
- **QR check-in** — tapping an upcoming booking on My Bookings opens a
  Booking Detail screen showing a real QR code (encodes the booking ID),
  once that booking is approved/paid. This is ready for an organizer to
  scan — the actual scanner is organizer-side, still not built.

---

## What's still NOT built (by your explicit choice)

- **Organizer side entirely** — stall management, approvals, QR scanning,
  revenue reports. The vendor app can generate a QR code, but nothing scans
  it yet, since that's an organizer feature.
- **Card payments** — only GCash/Maya work through PayMongo; cards need a
  different integration (tokenization).
- **Recurring booking automation** — the `is_recurring` flag saves, but no
  background job actually re-books a stall automatically each week.

---

## Testing checklist

1. Run the SQL in `supabase/storage-setup.sql`
2. Install the 4 new packages
3. Extract and merge the files
4. `npx expo start -c`
5. Go to **Settings → Complete/Edit profile**, tap the upload box, pick a
   photo — should show a thumbnail after uploading
6. Book a stall → check **Notifications** (bell icon) → should see "Booking
   request submitted"
7. On **My Bookings**, tap an upcoming booking → should show a real QR code
   if the status is `paid` or `approved` (if it's still `pending`, you'll
   see the "waiting" message instead — that's correct behavior)
8. After a real or manually-updated payment, check Notifications again for
   "Payment confirmed"
