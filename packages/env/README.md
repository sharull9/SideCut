# Environment validation

`@sidecut/env` uses [T3 Env Core](https://env.t3.gg/docs/core) and Zod. Import
the entry point for your runtime: `/web`, `/landing`, `/cloud`, or `/desktop`.
Factories validate supplied values; they do not read files or implicitly access
`process.env`. Browser entry points contain only public `VITE_` schemas.
Keep server imports out of client code.

Blank values become `undefined`. Browser settings and desktop overrides are
optional, so the local editor works without cloud credentials. Invalid supplied
values throw. WorkOS is required when Convex evaluates its auth configuration;
R2 credentials are required only when a storage action needs them. Storage
validation errors omit credential values.

## Setup

| Location                  | How values are loaded                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/.env.local`     | Copy the adjacent `.env.example`; Vite loads public settings at startup/build time.                                                                                                                        |
| `apps/landing/.env.local` | Copy the adjacent `.env.example`; Vite loads the public editor URL.                                                                                                                                        |
| Root `.env.local`         | Convex CLI manages deployment selection when run from the repository root.                                                                                                                                 |
| Convex deployment         | Use `apps/cloud/.env.example` as a reference; set WorkOS/R2 values in the dashboard or with `vp exec convex env set NAME VALUE` from the root. Copying the file locally does not configure the deployment. |
| Desktop process           | Export overrides listed in `apps/desktop/.env.example` in the launching shell. Electron does not read `.env` automatically.                                                                                |
| CLI/MCP scripts           | Export optional settings from the root `.env.example`, or explicitly use Node's `--env-file=.env` before the script path.                                                                                  |

The Convex CLI may write `VITE_WORKOS_CLIENT_ID` into the root `.env.local`.
Copy that public value and your deployment's Convex URL into the web app's
`.env.local`; Vite uses the app directory rather than the repository root.
For cloud features, configure both `VITE_CONVEX_URL` and `VITE_WORKOS_CLIENT_ID`.
Production origins also need `VITE_WORKOS_API_HOSTNAME`. Register the redirect
URI and origin with WorkOS. Restart Vite after changing environment files.

Only `.env.example` files are tracked. Never put R2 credentials in `VITE_*` values.
