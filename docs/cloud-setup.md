# Cloud setup for LV012

Use Convex for metadata and team authorization, WorkOS AuthKit for identity, and Cloudflare Workers Static Assets for the web app. Cloudflare R2 is the selected private object store for LV013. This records the user's provider selection on 2026-10-29. Region and spending limits are still deployment settings; no paid resources have been created.

## Configure Convex and WorkOS

The CLI created and selected the hosted development deployment `sheikh-arafat-ulla:sidecut:dev/lv012` in US East on 2026-10-29. Its public URL is `https://qualified-gnu-309.convex.cloud`. The local selection is in the gitignored root `.env.local`. Application functions are deployed, and anonymous team reads are rejected by the hosted backend.

Ran `pnpx workos@latest integrate --mode agent --no-tui --no-branch --no-git-check --install-dir apps/web --force`. The installer provisioned a WorkOS development environment and wrote credentials to the gitignored `apps/web/.env.local`. Its duplicate server-only TanStack routes/provider were removed because Cloudflare currently hosts a static SPA; the existing AuthKit React Teams flow uses the provisioned environment. Server credentials were set on Convex through its CLI, and `vp exec convex dev --once` completed successfully. Do not repeat `integrate --force` for routine development: it may provision a new environment.

The checked-in `authKit.dev` configuration registers `http://localhost:3000/` and writes the public `VITE_WORKOS_CLIENT_ID` into the root `.env.local`. Vite runs from `apps/web`, whose local public settings now include that client ID, `VITE_CONVEX_URL`, and `VITE_WORKOS_DEV_MODE=true`. Keep API keys under server-only names. The installer also creates a claim token; account claiming remains a separate step through `pnpx workos@latest claim` from `apps/web`, because claiming permanently associates the environment with an account.

1. Run `vp run dev:cloud` from the repository root and select the SideCut Convex project. This configures `CONVEX_DEPLOYMENT` and generates API bindings for `apps/cloud/src/convex`. Keep local environment files untracked.
2. Set `WORKOS_CLIENT_ID` in the Convex deployment's environment settings. It is a public identifier. The backend verifies WorkOS JWTs using the client-specific JWKS, following the [Convex AuthKit configuration](https://docs.convex.dev/auth/authkit/add-to-app).
3. Configure the WorkOS environment's [JWT template](https://workos.com/docs/authkit/jwt-templates) to include typed, signed email claims:

   ```text
   {
     "email": {{ user.email }},
     "email_verified": {{ user.email_verified }}
   }
   ```

   Invitations fail closed when verified email is missing. Never replace these signed claims with an email supplied by a browser request.

4. Deploy development functions with `vp exec convex dev --once`; reserve `vp exec convex deploy` for a separately configured production deployment. Configure separate development and production WorkOS applications/environments. Keep API keys and deploy credentials in the host's secret storage, never in public Vite variables or project archives.

The backend owns team membership and invitations in Convex. WorkOS supplies identity only; WorkOS organization roles are not an alternative authorization source. Every request reads current membership, so demotion and removal take effect without waiting for an organization-role JWT to refresh. Account/session revocation still depends on WorkOS token lifetime and refresh behavior.

## Deploy the web assets to Cloudflare

1. Run `vp run build:cloudflare`. The preparation script copies the production public assets into `apps/web/.cloudflare` and copies TanStack's `_shell.html` to `index.html` for Cloudflare SPA routing. The desktop/Nitro output is preserved.
2. Deploy `apps/web/wrangler.jsonc` through the authenticated Cloudflare deployment workflow. The asset directory is relative to that configuration file. Cloudflare's [SPA fallback](https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/) serves client routes.

The editor's Teams button opens the WorkOS/Convex account and team dialog. The cloud SDKs load only when this dialog opens. Configure the following public build variables in `apps/web/.env.local` for development or the Cloudflare build environment for production:

```text
VITE_CONVEX_URL=https://<deployment>.convex.cloud
VITE_WORKOS_CLIENT_ID=client_<application>
VITE_WORKOS_API_HOSTNAME=auth.<your-domain>
```

Register the app origin in WorkOS CORS settings and its root URL (for example, `https://<your-domain>/`) as the redirect and sign-out URI. The dialog opens automatically on the OAuth return and AuthKit processes the code/state. For localhost development without a custom auth domain, set `VITE_WORKOS_DEV_MODE=true`; production always disables this mode. API keys must never use the `VITE_` prefix.

The dialog supports team creation/selection, a verified-email invitation inbox, member role changes, removal, and sent-invitation revocation. Invitations are shown in the recipient's Teams inbox; creating one does not send email. Selecting a team does not upload a local project. Desktop custom-scheme origins and unconfigured builds show a local-only state; desktop OAuth remains separate acceptance work.

## Keep media private

LV012 exposes no media endpoints. In LV013, create a private R2 bucket with public access disabled. Store object ownership in Convex and require current team membership before issuing bounded upload/download grants. A tenant-prefixed object key alone is not authorization. Test unauthorized object delivery as well as metadata access before enabling uploads.

Cloudflare video playback/transcoding will be assessed in LV014; this provider selection does not claim R2 supplies transcoding. No R2 bucket, upload endpoint, playback service, or email delivery was provisioned in LV012.

## Authorization behavior

- Owners can change roles and invite administrators. Demoting the last owner is rejected; removing an owner requires demotion first.
- Administrators can invite members/viewers and remove members/viewers. They cannot change roles, invite administrators, or remove administrators/owners.
- Members and viewers can read their own team's membership. Their editing/media permissions will be applied when cloud resources are added.
- Invitations bind to normalized verified email, expire after seven days, can be revoked, and are accepted once. Acceptance checks that the inviter still has authority. Acceptance never overwrites an existing member's role.
- Team IDs and membership IDs supplied by a caller never establish authorization.

## Verification and remaining acceptance

`apps/cloud/src/convex/teams.test.ts` runs the real function handlers against Convex's in-memory test implementation. It covers unauthenticated calls, two-tenant isolation, verified-email binding, invitation expiry/revocation/replay, last-owner protection, administrator escalation, member removal, and inviter demotion.

`vp run verify:cloud-teams` tests the unconfigured production build in Chromium, including dialog opening/reopening, Escape, focus return, mobile bounds, and page errors. Run it after `vp run build:cloudflare` without cloud variables. For a configured localhost build, set `SIDECUT_CLOUD_CONFIGURED=1`; this uses port 3000 and also verifies navigation to hosted WorkOS sign-in. Both modes passed. Configuration tests enforce HTTPS for remote backends and disable development token storage in production.

The WorkOS CLI's `verify-login` check passed real user creation, password authentication, and token checks, and removed its throwaway user. This checks the identity provider rather than completing browser OAuth. A scan of 141 public build files found none of the provisioned API key, cookie password, or claim token. Full repository checks passed with 638 tests. Local command output is retained in `logs/workos-*.log`.

On 2026-11-01 an existing signed-in browser session connected to the hosted development Convex backend and loaded the account and an empty team list. A fresh OAuth redirect, team mutations, actual JWT email claims, email delivery, desktop OAuth, and Cloudflare deployment remain unverified. The JWT template above is still required for invitations; authentication alone does not establish verified-email claims. LV012 remains in progress until the remaining hosted service checks pass. Build/check logs are local artifacts under the gitignored `logs/` folder.

## LV013–LV014 backend continuation

The library/version backend and private R2 adapter are described in [the cloud library verification report](verification/lawn-videorc-cloud-library.md). They require the server-only R2 settings documented there. No bucket or processing service has been provisioned. One-minute signed object URLs retain access until expiry after member removal. Library/upload UI, processing, thumbnails and live object acceptance remain outstanding; these phases are not complete.

## LV015 share services

The typed cloud API now exposes `shareAccess.create/open`, `shares.list/revoke/view/comment/resolve/heartbeat/workflow`, and `storage.guestUrl`. These implement the service boundary only; no guest page has been shipped. Link/session tokens are bearer secrets and should stay out of logs and query strings. A future guest page should consume the link token from a URL fragment, retain its returned session only for the review session, and use authenticated WorkOS context for private grants. See [guest-review verification and limits](verification/lawn-videorc-guest-scenes.md), including the one-minute lifetime of already-issued object grants.

## Studio cloud takes and editing from the cloud

Signed-in members with editing access can choose **Save to → Cloud** in Studio. The take uploads while it records: `versions.beginStream` opens a version before its size is known, the browser sends equal 8 MiB parts through `storage.partUrl`, and on stop `versions.seal` fixes the size and part count before `storage.complete`. `complete` refuses unsealed versions. Studio keeps a local copy of takes up to 128 MiB, so a failed upload of a short take is still offered as a local take. Signed-out users, viewers and builds without cloud configuration record to this device only.

After the upload completes, Studio opens `/edit/$mediaId`. That page asks `storage.sourceUrl` for a one-minute signed link to the original upload, downloads it and imports it into the open project (re-imports of the same file are deduplicated). The library's **Open in editor** button uses the same page. `sourceUrl` does not need the processing service; it serves the original once its upload has completed.

Before using this against a real bucket:

1. Deploy the new functions with `vp exec convex dev --once`.
2. Add an R2 CORS rule for each app origin allowing `PUT` (part uploads) and `GET` (editor downloads), with the `Content-Type` request header allowed. Without it the browser blocks both requests.

Live output stays in the desktop app, which streams through the native recorder. Studio scenes are not streamed yet.
