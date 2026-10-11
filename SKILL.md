---
name: plant-app
description: Architecture, stack, conventions and rules for William's plant care app (React Native + Expo app, Express API, camera plant ID, watering reminders). Use when building, changing or reviewing any part of the plant app.
---

# Plant App

A React Native app that identifies a plant from the phone camera, shows how much and how often to water it, and reminds the user when watering is due.

Follow this file for every change to the app or the API. If a task would break one of the design rules below, say so before writing code.

## Stack

| Layer | Tech |
| --- | --- |
| Mobile app | React Native, Expo, Expo Router, NativeWind, TypeScript |
| Local data | expo-sqlite |
| Reminders | expo-notifications (local, scheduled) |
| Camera | expo-camera (MVP); react-native-vision-camera for live ID (v2, needs a dev build) |
| API | Express, TypeScript, zod, helmet, pino |
| Plant ID | Plant.id (primary), Pl@ntNet (fallback, Phase 1), own FastAPI model (Phase 2) |
| Database | MongoDB Atlas (from Phase 1) |
| Hosting | Azure, IaC via Bicep |
| App builds | EAS Build, EAS Submit, EAS Update |

Do not introduce Next.js, PHP, OpenAI or a Python backend unless asked. Python is only for a future self-hosted ID model service.

## MVP scope

In: photo plant ID, watering amount and frequency per species, manual add, local reminders, landing page with privacy policy and support page.

Out: user accounts, cloud sync, server push, AI chat, own ID model. Do not build these unless asked.

## Design rules

1. **Device first.** Plant list, care lookups and reminders work offline. The server is only needed for identification (and later, sync). A server outage must never stop reminders.
2. **Stateless API.** No sessions, files or state kept in server memory or on disk. Any instance must be able to answer any request.
3. **Swappable providers.** Plant ID goes through one interface: `identify(image) → { species, confidence, candidates }`. Each provider is an adapter. Never call a provider directly from a route.
4. **Managed state.** Data in MongoDB, files in object storage, secrets in environment variables.
5. **Versioned API.** Every route starts with `/v1`. Breaking changes go to `/v2`; old app versions stay in use for months.
6. **No secrets in the app.** API keys live only on the server. Never put a provider key in the React Native code or Expo config.

## Repo layout

```
plant-app/           (Expo)
  app/               Expo Router screens
  components/
  lib/
    api.ts           API client, base URL from build profile
    db.ts            expo-sqlite setup and queries
    notifications.ts schedule / cancel / reschedule reminders
    care.ts          species care lookup
  data/species.json  bundled care data (20–30 common houseplants)

plant-api/           (Express)
  src/
    index.ts         app setup, middleware, routes
    routes/
      health.ts      GET /v1/health
      identify.ts    POST /v1/identify
    providers/
      index.ts       identify() interface + fallback chain
      plantid.ts     Plant.id adapter
      plantnet.ts    Pl@ntNet adapter (Phase 1)
    middleware/
      rateLimit.ts
      errors.ts
  public/
    index.html       landing page
    privacy.html     privacy policy
    support.html
  Dockerfile
  .env.example       never commit .env
```

## API

All JSON. Errors are `{ "error": { "code": string, "message": string } }` with the correct HTTP status.

| Method | Path | Purpose | Auth | Phase |
| --- | --- | --- | --- | --- |
| GET | `/v1/health` | Uptime check | None | 0 |
| POST | `/v1/identify` | Compressed image in → species, confidence, top 3 candidates, care data | Device token, rate limited | 0 |
| GET | `/v1/species?updatedSince=` | Care data updates | None | 1 |
| POST | `/v1/auth/...` | Sign in | None | 1 |
| GET | `/v1/plants?since=` | Pull changed plants | JWT | 1 |
| PUT | `/v1/plants/:id` | Create or update (client-generated ID, idempotent) | JWT | 1 |
| DELETE | `/v1/plants/:id` | Soft delete | JWT | 1 |
| POST | `/v1/plants/:id/waterings` | Log watering, recompute next due date | JWT | 1 |
| DELETE | `/v1/me` | Delete account and all data | JWT | 1 |

Rules:
- Validate every request body with zod.
- Cap image size (about 5 MB after compression); set `express.json({ limit })` accordingly.
- Every outbound provider call has a timeout (about 8 s) and one retry with backoff.
- Below the confidence threshold, return the top 3 candidates instead of a single guess.
- MVP auth: the app creates a random device token on first launch and sends it as a header; rate limit by device token and IP.

## Data model

The phone's local tables use the same shapes as the MongoDB collections, so sync is a copy, not a migration.

- `species`: `_id` (slug), `scientificName`, `commonNames[]`, `water: { everyDays, amountMlPerLitreOfPot }`, `light`, `providerIds: { plantId, plantNet }`
- `users` (Phase 1): `_id`, `email`, `authProvider`, `createdAt`, `timezone`
- `plants`: `_id`, `userId`, `speciesId`, `nickname`, `potSizeLitres`, `lastWateredAt`, `nextDueAt`, `updatedAt`, `deletedAt`
- `wateringLogs`: `_id`, `plantId`, `userId`, `wateredAt`
- `identifications`: `_id`, `userId` or `deviceId`, `provider`, `topResult`, `confidence`, `chosenSpeciesId`, `createdAt` (TTL ~90 days)

Rules:
- Plants store `speciesId`, never copied care text.
- Always query plants by `userId` first.
- Use `updatedAt` and soft delete (`deletedAt`) on plants so offline sync works.
- Store dates in UTC; use the user's timezone to schedule reminders.
- Log `chosenSpeciesId` when a user corrects an ID.

## Key flows

**Identify**
1. Take photo → resize on the phone (~1024 px long edge) → `POST /v1/identify`.
2. API checks rate limit → calls provider through `identify()`.
3. Confident → show species + care. Not confident → user picks from top 3 or searches.
4. Rate limit hit, network error or provider failure → offer manual add. No dead-end screens.
5. Save plant → compute `nextDueAt` → schedule local notification.

**Reminder**
1. Saving a plant computes `nextDueAt` from the species' watering interval.
2. The app schedules a local notification.
3. User taps "Watered" → log it, compute the next date, reschedule.
4. Phase 1: the event also syncs to the API.

A saved plant is never re-identified.

## Scaling phases

| Area | Phase 0 (MVP) | Phase 1 (growth) | Phase 2 (scale) |
| --- | --- | --- | --- |
| API | 1 container on Coolify | 2+ containers behind a load balancer | Autoscaling containers |
| Database | None or Atlas free tier | Atlas paid cluster, backups | Larger cluster, read replicas |
| Rate limits | In-memory | Redis, shared | Redis + per-plan quotas |
| Plant ID | Plant.id | + Pl@ntNet fallback | Own model for common species + paid API |
| Reminders | Local only | + Expo Push | Push via job queue (BullMQ) |
| Photos | Not stored | R2/S3 presigned uploads | CDN in front |

Write Phase 0 code so Phase 1 needs no rewrite: no in-memory state the API depends on beyond the rate limiter, and the rate limiter behind an interface so Redis can replace it.

## Security, privacy and store requirements

- HTTPS only; `helmet`; body size limits; zod validation.
- Phase 1 auth: short-lived JWT access tokens + refresh tokens; hash passwords with bcrypt or argon2.
- Photos are sent to the provider and discarded in the MVP; the privacy policy must say so and name third parties.
- Camera and notification permission messages must explain why (set via Expo config).
- When accounts exist, in-app account deletion is required (`DELETE /v1/me`).
- Store screenshots show the real app.

## Observability and deployment

- Sentry in app and API; pino JSON logs with a request ID; uptime monitor on `/v1/health`.
- Track identify calls per day, ID success rate, p95 latency and provider spend.
- Environments: `staging` and `production`, each with its own API URL, keys and database. The Expo build profile picks the API URL; test builds never hit production.
- API deploys from `main` to Azure (target compute service and CI pipeline TBD); JS-only app fixes ship via EAS Update; native changes need a new store build.
- CI on pull requests: typecheck, lint, API tests.

## Open questions

- Plant.id vs Pl@ntNet accuracy on real photos
- Source of watering data: provider response, own table, or both
- How watering amount is shown: ml per pot size, or "water until it drains" + frequency
- Free-plan daily identify limit
- Whether live camera ID is v2 or a launch feature

Ask before deciding any of these.
