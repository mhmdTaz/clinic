# The patient app

Expo (SDK 56) + expo-router, consuming `@clinic/api-client` — the same client the web uses, with
a different token store. Everything above that line is shared: contracts, response types, cache
keys, invalidation.

## Running it

```bash
CLINIC_API_URL=http://192.168.1.10:3000 pnpm --filter @clinic/mobile start
```

`CLINIC_API_URL` must be an address the **device** can reach. `localhost` is the phone, not your
machine — use your machine's LAN address, and remember the API's CSP and CORS posture applies.

Push needs `EAS_PROJECT_ID` and a physical device; a simulator has no push service behind it and
`enrolForPush` says so rather than failing obscurely.

## What is here, and what is not

Done: sign-in and the session gate, the home screen, appointments (view and cancel), the bell,
account with push registration, offline reads, notification routing.

Not done: booking (a flow, not a button — doctor, window, slot), documents, the support threads,
and the entire doctor portal. The app has been typechecked, linted and unit-tested but **has not
been run on a device**.

## Where the logic lives

`src/lib/*` holds the rules worth testing — which appointment is next, what a notification opens,
what may be cached and for how long — with **no React Native imports**, so `pnpm --filter
@clinic/mobile test` exercises them without a runtime. A stray native import fails the suite
loudly rather than being shimmed around; see `test/react-native-stub.ts`.
