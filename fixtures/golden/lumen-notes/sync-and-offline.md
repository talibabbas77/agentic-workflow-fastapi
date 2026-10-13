# Sync and offline access

Lumen Notes keeps your notes in sync across the web, desktop, and mobile apps, and lets you keep working when you lose your connection. This page explains how sync works, what is available offline in each app, and how to recover from conflicts and deletions.

## How sync works

Every change you make is sent to Lumen servers and then to your other devices. When you are online, changes usually appear on other devices within 5 seconds. Sync runs continuously, so there is no sync button to press.

The sync indicator in the bottom-left corner of the sidebar shows the current state:

| Indicator | Meaning |
|---|---|
| Green check mark | All changes are synced |
| Blue spinning arrows | Changes are being sent or received |
| Gray cloud with a slash | You are offline, and changes are saved on this device |
| Red exclamation mark | Sync stopped because of an error. Select the icon for details |

## Offline access in each app

What you can open without a connection depends on the app:

- **Desktop apps**: every notebook you have access to is stored on your computer and is available offline by default.
- **Mobile apps**: only notebooks you mark for offline use, plus the 20 notes you opened most recently. To mark a notebook, press and hold it in the sidebar and select **Make available offline**.
- **Web app**: there is no offline mode. If your connection drops, the editor holds your unsent changes for up to 10 minutes and shows a **Reconnecting** banner. Keep the tab open until the banner goes away.

## Working offline

While offline, you can create, edit, move, and delete notes, and write comments. Your changes are queued on the device and uploaded automatically when you reconnect. Attachments you add offline are uploaded at the same time.

Some actions need a connection and are disabled while you are offline:

- Sharing notes and inviting people.
- Creating or changing public links.
- Exporting a whole workspace.
- Anything that uses an integration, such as creating a meeting note from a calendar event.

## Sync conflicts

If the same note is changed on two devices while at least one of them is offline, Lumen merges the changes paragraph by paragraph when they reconnect.

If both devices changed the same paragraph, Lumen cannot merge them automatically. It keeps the version that synced last in the original note and saves the other version as a separate note named "Note title (conflicted copy, device name, date)" in the same notebook. Compare the two, copy over anything you want to keep, and delete the conflicted copy.

You can find every conflicted copy from the last 30 days under **Settings > Sync > Conflicts**.

## Selective sync on desktop

If a large workspace is filling up your disk, you can choose which notebooks the desktop app keeps locally:

1. Go to **Settings > Sync > Selective sync**.
2. Clear the check box next to each notebook you do not need on this computer.
3. Select **Apply**.

Notebooks you clear are removed from this computer only. They stay in your account and on your other devices, and you can still open them while online.

The desktop app also downloads attachments larger than 50 MB only when you open them. You can turn this off with the **Download large attachments on demand** setting on the same page.

## Storage on mobile devices

To see how much space Lumen uses on your phone or tablet, go to **Settings > Storage** in the mobile app.

- **Clear offline cache** removes downloaded notes and attachments from the device. Any unsynced changes are uploaded first, and nothing is deleted from your account.
- By default, attachments larger than 5 MB download only over Wi-Fi. To allow them over mobile data, turn on **Download over cellular**.

## Recovering deleted notes

Deleted notes go to the Trash in the sidebar. Notes stay in the Trash for 30 days and are then permanently deleted.

To restore a note, open **Trash**, select the note, and select **Restore**. The note goes back to its original notebook. If that notebook was also deleted, the note is placed in a new notebook called **Restored**.

On Team and Enterprise workspaces, admins can restore notes deleted by any member. Selecting **Empty trash** deletes everything in the Trash permanently and cannot be undone.
