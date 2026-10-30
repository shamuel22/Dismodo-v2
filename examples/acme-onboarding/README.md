# Acme Onboarding — a second product on DISMODO

A fictional workplace-training portal that builds on DISMODO without adopting its brand or catalog:

- **Its own interface**: a light corporate portal; DISMODO appears only as the embedded practice.
- **Its own key and data**: a separate tenant; the key stays on Acme's server.
- **Its own experience**: [`halves-vs-quarters@1.0.0`](experiences/halves-vs-quarters/README.md), written by an
  independent builder (Muse Code), published at startup through the SDK — no engine code changed.
- **Embedded session**: `<dismodo-session token="…" api="…">` loaded from the DISMODO server.
- **Evidence for managers**: `/manager` reads each session's report through the SDK.

## Run it

```bash
# 1. DISMODO, serving its web build (needed for the embed script)
pnpm db:up && pnpm seed
pnpm --filter @dismodo/web build
pnpm dev:api                                   # http://localhost:4100

# 2. A key for Acme's tenant
pnpm tenant:create --slug acme --name "Acme Onboarding"
printf "ACME_DISMODO_API_KEY=dsm_...\nACME_MANAGER_PASSCODE=choose-one\n" > examples/acme-onboarding/.env

# 3. Acme's portal
pnpm --filter @dismodo-example/acme-onboarding start   # http://localhost:4300
```

Employees are identified to DISMODO only by pseudonymous refs (`acme-emp-1042`); names stay in Acme.

**This is a demo, not a template for production.** It has no employee sign-in, so it listens on loopback only
(`HOST=127.0.0.1`) and the manager page asks for `ACME_MANAGER_PASSCODE` (any user name). A real product
authenticates its own users before it calls DISMODO on their behalf.
