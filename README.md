# EmberFans Creator Platform

EmberFans is beginning as a real local service with an existing GitHub Pages visual demo and a Node.js application server for protected account and content workflows.

## What works now

- Account registration and sign-in
- Password hashing with bcrypt
- Eight-hour signed browser sessions
- Adult confirmation and Terms acceptance recorded at account creation
- SQLite persistence stored outside version control
- Viewer, performer, moderator, and administrator roles
- Performer-only content publishing API
- Creator studio with protected image/video upload support
- Authenticated media delivery that never exposes the media directory as a static URL
- SFW photo, NSFW photo, video, and live-event content records
- Permissioned emergency-stop API design with an audit trail
- Rate limits and common security headers

## Run locally

1. Install Node.js 24 or newer.
2. Copy `.env.example` to `.env` and set a strong, private `JWT_SECRET`.
3. Install dependencies with `npm install`.
4. Start the service with `npm start`.
5. Open `http://127.0.0.1:3000/auth.html` to create an account.

The SQLite database is created at `data/emberfans.db` by default. It is intentionally excluded from Git.

## Creator workflow

1. Register an account at `http://127.0.0.1:3000/auth.html`.
2. An administrator approves the performer role locally with:

   `node scripts/promote-user.js user@example.com performer`

3. Sign in again, then open `http://127.0.0.1:3000/creator.html`.
4. Publish a SFW photo, NSFW photo, video, or live-event record and optionally upload a JPEG, PNG, WebP, MP4, or WebM file up to 100 MB.

Uploads are stored outside the public static directory. The browser can request media only through the authenticated `/api/media/:contentId` endpoint after the service checks the viewer's entitlement.

## Current API

| Method | Route | Access |
| --- | --- | --- |
| `GET` | `/api/health` | Public |
| `POST` | `/api/auth/register` | Public, rate-limited |
| `POST` | `/api/auth/login` | Public, rate-limited |
| `GET` | `/api/me` | Signed-in user |
| `GET` | `/api/content` | Signed-in user |
| `POST` | `/api/content` | Performer or administrator |
| `POST` | `/api/content/:id/media` | Owning performer or administrator |
| `GET` | `/api/media/:contentId` | Signed-in entitled viewer |
| `POST` | `/api/device-sessions/:id/stop` | Device-session participant |

## Production requirements not yet implemented

This foundation is not ready for real payments, real NSFW media, live streaming, or device-vendor operation. Those steps require a server host, managed database, approved adult-content payment provider, age/identity verification, private media storage with expiring links, live-video provider, moderation tooling, and vendor-specific device integrations.

The emergency-stop endpoint establishes the authorization and audit model. It is not a connection to a physical device. Browser software cannot guarantee that viewers never record content; the appropriate next layers are watermarking, signed playback, access/session controls, and incident-response tooling.

## GitHub Pages note

GitHub Pages can serve the visual static demo but cannot run `server.js` or SQLite. Deploy the Node application to a server host before exposing registration and protected APIs publicly.
