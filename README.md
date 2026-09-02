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
- Communities, channels, persisted text messages, direct conversations, and moderator message removal
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

## Community workflow

1. Sign in and open `http://127.0.0.1:3000/community.html`, or use the `#` Communities button in the dashboard rail.
2. A performer or administrator can create a community; each new community starts with `# welcome` and `# general`.
3. Members join a community before viewing or posting in its channels.
4. Community owners, moderators, and administrators can add `text`, `forum`, `voice`, and `auditorium` channels, each with an optional descriptive header.
5. Text channels store messages. Forum channels store titled discussion posts. Voice and auditorium channels preserve room type, permissions, and headers until a real-time audio provider is connected.
6. Community moderators can right-click category headers or channels to create a typed channel or a category. Drag a channel to another category to persist its sidebar placement.

The direct-message API is available for signed-in users. The initial community screen focuses on channels first; a dedicated inbox interface is the next client-side community enhancement.

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
| `GET`, `POST` | `/api/communities` | Signed-in user / performer or administrator |
| `POST` | `/api/communities/:id/join` | Signed-in user |
| `GET`, `POST` | `/api/communities/:id/channels` | Member / community moderator |
| `GET`, `POST` | `/api/channels/:id/messages` | Community member |
| `DELETE` | `/api/channel-messages/:id` | Message author or moderator |
| `GET`, `POST` | `/api/direct-conversations` | Signed-in user |
| `GET`, `POST` | `/api/direct-conversations/:id/messages` | Conversation participant |

## Production requirements not yet implemented

This foundation is not ready for real payments, real NSFW media, live streaming, or device-vendor operation. Those steps require a server host, managed database, approved adult-content payment provider, age/identity verification, private media storage with expiring links, live-video provider, moderation tooling, and vendor-specific device integrations.

The emergency-stop endpoint establishes the authorization and audit model. It is not a connection to a physical device. Browser software cannot guarantee that viewers never record content; the appropriate next layers are watermarking, signed playback, access/session controls, and incident-response tooling.

## GitHub Pages note

GitHub Pages can serve the visual static demo but cannot run `server.js` or SQLite. Deploy the Node application to a server host before exposing registration and protected APIs publicly.
