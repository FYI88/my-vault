# Future Uses / Roadmap Notes

## Windows Hello Session Quick Unlock (Planned)

### Goal
Add an optional Windows Hello quick-unlock flow for convenience, without replacing the root passphrase model.

### Product Rules
- Root unlock after app start always requires passphrase.
- Windows Hello quick unlock is optional and disabled by default.
- Quick unlock only works after one successful passphrase unlock in the current app session.
- User-selectable quick unlock window: 10, 20, or 30 minutes.
- If the app is closed/restarted/crashes, quick unlock is reset and passphrase is required again.

### Security Model
- Never cache or persist the raw passphrase.
- Use RAM-only session state (ephemeral token/flag) plus expiry time.
- No quick-unlock data in localStorage, settings files, logs, or network.
- On any error, timeout, or unavailable Hello API, fail closed to passphrase.

### Settings UX
- Toggle: `Enable Windows Hello quick unlock (session only)`
- Selector: `Quick unlock window` -> `10 min / 20 min / 30 min`
- Lock screen options (when eligible):
  - `Use Windows Hello`
  - `Use passphrase`

### Edge Cases
- Windows Hello not configured on device.
- RDP/VM contexts where Hello may be unavailable.
- Too many failed Hello attempts -> force passphrase only for the rest of session.
- Manual action: `Lock and require passphrase`.

### Implementation Notes
- Add renderer bridge method: `vaultAPI.verifyUserPresence()`.
- Implement platform hooks in Electron and Tauri shells with consistent behavior.
- Keep quick-unlock eligibility checks centralized in one session state module.
- Add tests for:
  - startup requires passphrase
  - quick unlock available only post-root unlock
  - timeout expiry behavior (10/20/30)
  - restart resets quick unlock
  - fail-closed on API errors
