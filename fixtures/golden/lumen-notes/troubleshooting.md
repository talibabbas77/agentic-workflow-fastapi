# Troubleshooting

This page lists the error messages you may see in Lumen Notes and how to fix them, plus steps for common problems with the desktop app, search, and sync. If none of this helps, send us your logs as described at the end of the page.

## Error messages

### LN-101: Your session has expired

You were signed out, usually because of inactivity, a password change, or an admin signing you out. Sign in again. Changes you made before the message appeared are kept on the device and uploaded after you sign in.

If this message comes back every few minutes, check your device clock. Lumen rejects sessions from devices whose clock is more than 5 minutes off. Turn on automatic date and time in your system settings.

### LN-207: Device limit reached

You are signing in on more devices than your plan allows. To continue, sign out of a device you no longer use. You can do this from any signed-in device under **Settings > Account > Security > Active sessions**. Upgrading to a paid plan removes the device limit.

### LN-310: Sync paused, storage full

Your workspace has reached its storage limit. Note text still syncs, but new attachments do not upload. To free space, delete large attachments and then empty the Trash, because files in the Trash still count toward storage. Sync resumes within 1 minute of dropping below the limit.

### LN-415: File too large to upload

The file is bigger than your plan allows for a single upload. Compress the file, split it into parts, or upload it somewhere else and paste a link into the note.

### LN-502: Can't reach Lumen servers

The app cannot connect. First check status.lumen-notes.example for an ongoing incident. If everything is operational there, your network may be blocking Lumen. Ask your IT team to allow `*.lumen-notes.example` on port 443 and to allow WebSocket connections to sync.lumen-notes.example.

### LN-623: You don't have access to this note

The note was moved, deleted, or your permission was removed. Check your Trash in case you deleted it yourself, or ask the person who shared it to share it again.

## Desktop app won't open or shows a blank window

1. Quit the app completely, including the icon in the system tray or menu bar.
2. Hold Shift while opening the app. This starts it in safe mode, which turns off hardware acceleration and custom themes.
3. If the app works in safe mode, go to **Settings > Preferences** and turn off **Use hardware acceleration**, then restart normally.
4. If the window is still blank, select **Help > Troubleshooting > Reset local data**. This deletes the local copy of your notes and downloads everything again. Any changes that had not synced are lost, so only do this if the sync indicator was green before the problem started.

## Search doesn't find a note

- New and edited notes become searchable within about 30 seconds.
- In the desktop app, search only covers notebooks that are synced to that computer. Notebooks you excluded with selective sync do not appear in results.
- Text inside PDF attachments and images is searchable on Plus, Team, and Enterprise only.

If a note still does not appear, rebuild the search index under **Settings > Advanced > Rebuild search index**. Rebuilding takes about 1 minute for every 5,000 notes. You can keep working while it runs.

## Notes look out of date on one device

If one device shows older content than your other devices, and the sync indicator is not showing an error, force a full resync:

1. Go to **Settings > Sync** on the device that is behind.
2. Select **Resync this device**.

This downloads all of your notes again from the server. Unsynced changes on the device are kept and uploaded first.

## Sending logs to support

If you contact support about a problem, logs help us find the cause faster.

- **Desktop**: select **Help > Troubleshooting > Export logs**. This saves a ZIP file with the last 7 days of app logs.
- **Mobile**: go to **Settings > About > Send diagnostics**. The logs are uploaded directly and you get a reference code to include in your email.

Logs contain technical events such as sync timings and error codes. They never include the content of your notes. Attach the ZIP file, or the reference code, to your email to support@lumen-notes.example.
