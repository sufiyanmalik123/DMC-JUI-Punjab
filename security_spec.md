# Security Specification — DMC JUI Punjab Campaign Platform

## 1. Data Invariants
1. `stats/supporters`: Public users may only create the initial counter (`count == 0` or `1`) or increment an existing counter by **exactly +1** (`incoming().count == existing().count + 1`). Public users can never decrement, reset, or jump the counter, and cannot delete the document.
2. `campaign_config/active`: Public visitors may read (`get`) the active campaign frame and branding, but **only** verified administrators (`isAdmin()`) may create or update it. `frameUrl` must strictly match `^(/assets/aistudio/|/uploads/frames/)[a-zA-Z0-9_\-]+\.png$`.
3. `gallery_items/{itemId}`: Public visitors may read (`get`, `list`) and publish (`create`) new gallery entries without signing in, provided the payload strictly matches all schema constraints (`imageUrl` matching `^/uploads/gallery/[a-zA-Z0-9_\-]+\.(png|jpg|jpeg)$`, bounded string lengths, `mimeType` in `['image/png', 'image/jpeg']`, `fileSize` between 1 byte and 10 MB, and `createdAt == request.time`). **Only** verified administrators may delete or moderate gallery entries.
4. `admins/{adminId}`: Only the bootstrapped administrator (`graphicsmalik123@gmail.com` with `email_verified == true`) may list, create, update, or delete admin role documents. Regular visitors cannot read or self-assign admin roles.

## 2. "Dirty Dozen" Adversarial Payloads
1. **Counter Jump Attack**: Update `stats/supporters` with `count: existing.count + 500` -> `PERMISSION_DENIED`.
2. **Counter Reset / Decrement**: Update `stats/supporters` with `count: 0` as unauthenticated user -> `PERMISSION_DENIED`.
3. **Stats Shadow Field Injection**: Update `stats/supporters` with extra field `hacked: true` -> `PERMISSION_DENIED`.
4. **Unauthorized Frame Swap**: Unauthenticated or non-admin user updates `campaign_config/active` -> `PERMISSION_DENIED`.
5. **Frame XSS / SSRF URL Injection**: Admin or attacker sets `frameUrl: "javascript:alert(1)"` or `"https://evil.example/a.png"` -> `PERMISSION_DENIED`.
6. **Unverified Admin Email Spoof**: User with `email == 'graphicsmalik123@gmail.com'` and `email_verified: false` attempts admin write -> `PERMISSION_DENIED`.
7. **Gallery XSS URL Injection**: Visitor creates `gallery_items` doc with `imageUrl: "data:text/html,<script>..."` -> `PERMISSION_DENIED`.
8. **Gallery Oversized Field Poisoning (DoW)**: Visitor submits `supporterName` with 5,000 characters -> `PERMISSION_DENIED`.
9. **Gallery Fake Timestamp**: Visitor submits `gallery_items` doc with backdated `createdAt` (`!= request.time`) -> `PERMISSION_DENIED`.
10. **Gallery Unauthorized Delete**: Non-admin visitor attempts `delete` on `gallery_items/{itemId}` -> `PERMISSION_DENIED`.
11. **Path Variable ID Poisoning**: Request uses 500-char or invalid-char document ID like `../../etc/passwd` -> `PERMISSION_DENIED`.
12. **Self-Assigned Admin Escalation**: Non-admin authenticated user creates `admins/{theirUid}` with `role: 'admin'` -> `PERMISSION_DENIED`.
