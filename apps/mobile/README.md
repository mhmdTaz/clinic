# The mobile app

Expo (SDK 56) and expo-router, for the two people who are away from a desk: **the patient** and
**the doctor between rooms**. Staff and administrators use the web. One app, one sign-in; the
session decides which portal opens (§10.1), and somebody who holds both can switch from Account.

It consumes `@clinic/api-client` — the same client the web uses, with a different token store. The
contracts, the response types, the cache keys and what each write invalidates are all shared.

## Running it

On a phone or simulator:

```bash
CLINIC_API_URL=http://192.168.1.10:3000 pnpm --filter @clinic/mobile start
```

`CLINIC_API_URL` must be an address the **device** can reach: `localhost` is the phone, not your
machine. Documents open from presigned object-storage links, so the storage endpoint must be
reachable from the device too. Push needs `EAS_PROJECT_ID` and a physical device.

In a browser, without a simulator:

```bash
pnpm --filter @clinic/web start
pnpm --filter @clinic/mobile preview:web
```

Then open http://localhost:8090. `scripts/web-preview.mjs` puts Expo's web build and the API on
one origin and drops the `Origin` header on API requests, because a phone sends none and the API
refuses a foreign one on writes. It is a development tool, not a shipped target — and it cannot
show anything native: the keychain and the encrypted vault are memory stand-ins there
(`*.web.ts`), and push, notification taps, the in-app browser and the keyboard do not exist.

## What is here

| Patient                                             | Doctor                                                         |
| --------------------------------------------------- | -------------------------------------------------------------- |
| Home — the next appointment, first                  | My day — who is next, and each appointment's note              |
| Appointments — upcoming, past and cancelled; cancel | My patients — the caseload, searched on the phone              |
| Booking — doctor, week, time, reason                | The chart — allergies first, then visits, prescriptions, files |
| Documents — opened from a sixty-second link         | The note — write, share, sign, add an addendum                 |
| Get help — ask, read the thread, reply              | Account                                                        |
| Updates, and Account with appointment reminders     |                                                                |

Links the server writes are **web paths** — a reminder says `/patient/appointments` — so the app's
routes mirror the web's, and `src/lib/routes.ts` maps the rest. Anything the app has no screen for
goes to the portal's home, never to "page not found" and never out of the app.

## What it relies on the API for

- **A retry is answered, not refused.** Booking and cancelling send an `Idempotency-Key` minted per
  attempt and reused when the same attempt is retried, so a response lost to a weak signal comes
  back as the appointment the first tap made (ADR-0034).
- **The clinic's own booking horizon**, from `/api/v1/clinic/booking-window`. Until it loads, or if
  it cannot, only this week is offered.
- **Visits matched by appointment** (`appointmentIds`), so a note started the evening before still
  shows on its appointment's day.
- **Lists that page.** A list with a natural bound — the diary window, a day, the caseload, a chart —
  is read whole up to a cap and says so when it stops; updates load a page at a time.

## What is not

- **It has not run on a phone or a simulator.** Everything above has been driven by hand in the web
  preview against a real API; nothing native has been.
- A patient's visit records, prescriptions and bills, and attachments on a support message.
- Editing vitals or diagnoses, prescribing, stock and the schedule — desk work, deliberately.
- Any language but English.

## Where the logic lives

`src/lib/*` holds the rules worth testing with **no React Native imports**, so
`pnpm --filter @clinic/mobile test` exercises them without a runtime: which appointment is next and
in which timezone, what a link from the server opens, what may be kept offline and for whom, what
to do on a launch with no signal, and which sections of a note to send. A stray native import fails
the suite loudly rather than being shimmed; see `test/react-native-stub.ts`.

`src/lib/device/*` is the native edge — the keychain and the encrypted vault (ADR-0033) — each with
a `.web.ts` stand-in for the preview.
