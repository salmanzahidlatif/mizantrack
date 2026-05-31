# Lessons Learned

## 2026-05-31 - Post-login `Invalid argument to Table.get()`

### What Happened
After Google sign-in, users reached `/dashboard` but the client crashed with `Uncaught TypeError: Invalid argument to Table.get()` from `useDbConfig`.

### Root Cause
`session.user.id` was assumed to exist by protected routes and client components, but NextAuth did not explicitly map `token.sub` into `session.user.id`. This created a runtime path where `userId` was missing after login.

### Fix Applied
- Added a session helper (`resolveSessionUserId`) to normalize `token.sub`.
- Added NextAuth `callbacks.session` mapping: `session.user.id = resolveSessionUserId(token) ?? ""`.
- Hardened login/protected routes to require `session.user.id` before redirecting/rendering app pages.

### Regression Test
- Added `src/test/auth.test.ts`:
  - `tokenSubPresent_ReturnsTokenSub`
  - `tokenSubMissing_ReturnsNull`

### Prevention
- Do not rely on TypeScript module augmentation alone for auth session shape; always set runtime session fields in auth callbacks.
- Gate protected routes on both session existence and required identity fields (`session.user.id`).
