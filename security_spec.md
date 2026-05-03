# Security Specification: Toonpur AI Voice

## 1. Data Invariants
- A user profile must have a valid `uid` matching the authenticated user.
- Character credits cannot be negative (enforced by backend, but rules should verify).
- Audio tasks belong to a specific user and have a mandatory expiration timestamp.
- User Tier is one of: 'free', 'starter', 'pro'.
- Audio data must be a string (Base64) and not exceed size limits.

## 2. The "Dirty Dozen" Payloads (Attack Vectors)

1. **Identity Spoofing**: Attempt to create a user profile with `uid` of another user.
2. **Credit Hijacking**: Attempt to update `credits` directly to a high value without a refill event.
3. **Tier Escalation**: Attempt to change `tier` from 'free' to 'pro' manually.
4. **Orphaned Audio**: Attempt to create an audio task for a non-existent user.
5. **Expired Access**: Attempt to read an `audio_task` where `request.time > expiresAt`.
6. **Task Poaching**: Attempt to read/download an audio task belonging to another user.
7. **Resource Exhaustion (ID)**: Attempt to create a task with a document ID that is 2KB of junk characters.
8. **Resource Exhaustion (Data)**: Attempt to inject a 10MB string into the `audioData` field.
9. **Timestamp Spoofing**: Attempt to set `createdAt` in the future or `expiresAt` in the past.
10. **System Field Injection**: Attempt to inject `isAdmin: true` into a user profile.
11. **Bulk Scraping**: Attempt to list all `audio_tasks` in the system.
12. **Malicious ID Poisoning**: Using path segments like `.` or `/` in IDs.

## 3. The Test Runner Plan
We will implement `firestore.rules.test.ts` to verify:
- `get` on a task is denied if user is not owner.
- `update` on `credits` is denied unless it's a specific decrement (or blocked for client completely).
- `create` on `users` is only allowed for the matching UID.
- `list` on `audio_tasks` is restricted by user ownership.
