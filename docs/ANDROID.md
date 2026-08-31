# My Vault for Android

**My Vault is a private, offline, zero-knowledge encrypted vault for your
photos, videos, documents, and journal.** Everything is encrypted on your
phone before it touches memory, and nothing ever leaves it — no cloud, no
network, no account. This page is for people installing the Android build.

---

## What you get

- **Private photo & video vault** — add files straight from your phone.
- **Documents & PDFs** — keep files, back them up, view and export them.
- **Encrypted daily journal** — mood, streaks, search, and "on this day".
- **Real security you control** — every item is encrypted with a key only your
  passphrase can open. Deleting an item destroys its key.
- **One encrypted file per vault** — the whole vault is a single `.cvault`
  file you can back up anywhere.

The crypto is identical to the desktop version, so a vault backed up on Android
opens on the PC app and vice-versa.

---

## What you need

- An Android phone or tablet running **Android 7.0 (2016) or newer**.
- The APK file (see *Which file to download*).

---

## Which file to download

| File | Size | Used by |
|------|------|---------|
| `my-vault-android.apk` | ~30 MB | **Every phone/tablet** — pick this one if unsure |
| `my-vault-android-arm64.apk` | ~10 MB | 64-bit ARM phones only (most newer phones) |

Unless you specifically want the smaller file, use **`my-vault-android.apk`**.

---

## How to install

1. **Get the APK onto your phone** — send it to yourself (email / chat / cloud
   drive), or copy it over USB. Then tap it to open it.
2. **Allow "install unknown apps"** when asked. Android shows this the first
   time you install from a source outside the Play Store: tap the prompt and
   choose **Allow**. (Looked up later at Settings → Apps → your file manager →
   **Install unknown apps**.)
3. Tap **Install**.
4. If a **Google Play Protect** warning appears: this is a normal self-built
   app, not a Play Store release. Tap **More info → Install anyway** if you
   trust whoever gave you the file.

Advanced users can install from a computer:

```bash
adb install -r my-vault-android.apk
```

---

## First run

- Tap **create a vault**. On Android there is **no folder picker** — the vault
  file is created automatically in the app's **private storage**.
- You'll be shown your **12 recovery words once**. Write them down somewhere
  safe. They are the only way back in if you ever forget your passphrase or
  have to restore.
- Back on the main screen you can **add files** from your phone and the **+
  add files** button.

> **Choose a passphrase only you know, and keep it with your recovery words.**
> There is no way to recover without them.

---

## Where the vault lives — and how to back it up

Your vault is one encrypted file (`myvault.cvault`) kept inside the app's
**private storage**. That storage is private to My Vault and disappears if the
app is uninstalled, so:

- **Always keep a backup.** In **Settings → back up a copy…** (or export an
  item / the vault) pick a location like Drive, email, or a USB drive.
- Uninstalling the app **deletes the vault** — never uninstall something you
  haven't backed up.
- The backup is your whole vault. Back up the `.cvault` **and** remember your
  passphrase / recovery words — a backup without the password is unusable
  (by design).

---

## How to update

- Just install the new APK over the old one (same steps as install). The app
  updates in place and your vault stays exactly where it is — updates never
  delete your data.
- Use **the same build type you installed originally**: if you installed
  `my-vault-android.apk`, update with `my-vault-android.apk`; if you used
  `-arm64`, update with `-arm64`. Mixing them can cause a "signatures don't
  match" block.
- If you ever see **"App not installed"**, don't panic and **don't uninstall
  first** — back up the vault, then contact the person who built/signed the app
  (you install an update only from builds signed the same way).

---

## Troubleshooting

| Problem | What to do |
|---------|-----------|
| "Play Protect" warning | Normal for a self-built app. Tap "Install anyway" if you trust the source. |
| Can't tap Install | Enable **install unknown apps** for the app you're opening the file from. |
| "Signatures do not match" / App not installed | Trying to mix the two build types, or a mismatched signer. Back up the vault, then get the matching APK. |
| Vault won't open after moving phones | Install the app, then **open a vault file** and choose your `.cvault` backup. |
| Accidental data loss | Restore from your backed-up `.cvault` — that's what it's for. |

---

*My Vault — private by design. Nothing you encrypt ever leaves your phone.*