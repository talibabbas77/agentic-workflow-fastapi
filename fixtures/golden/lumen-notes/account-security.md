# Account security

This page explains how to protect your Lumen Notes account: password rules, two-factor authentication, recovery codes, and how to manage the devices that are signed in to your account.

## Password requirements

Your password must:

- Be at least 12 characters long.
- Include at least one number or symbol.
- Not match any of your last 5 passwords.
- Not appear in our list of passwords exposed in public data breaches.

To change your password, go to **Settings > Account > Security > Change password**. Changing your password signs you out of every other session.

If you forgot your password, select **Forgot password** on the sign-in page. The reset link we email you is valid for 1 hour and can be used only once.

## Two-factor authentication

Two-factor authentication (2FA) asks for a second step after your password. Lumen Notes supports two methods:

- **Authenticator app**: an app on your phone that shows a 6-digit code that changes every 30 seconds.
- **Security key**: a hardware key or built-in device authenticator that supports WebAuthn. You can register up to 5 security keys.

Lumen Notes does not send sign-in codes by text message.

To turn on 2FA:

1. Go to **Settings > Account > Security > Two-factor authentication** and select **Set up**.
2. Scan the QR code with your authenticator app, or follow the prompt to register a security key.
3. Enter the code to confirm, then save your recovery codes.

### Requiring 2FA for your team

Admins on Team and Enterprise workspaces can require 2FA for all members under **Settings > Workspace > Security > Require two-factor authentication**. Members who have not set it up get 7 days to do so. After that, they cannot open the workspace until 2FA is on.

## Recovery codes

When you turn on 2FA, Lumen Notes generates 10 recovery codes. Each code is 10 characters long and works only once. Use a recovery code when you cannot get a code from your authenticator app or security key: on the sign-in screen, select **Use a recovery code**.

To see how many codes you have left, or to generate a new set, go to **Settings > Account > Security > Recovery codes**. Generating a new set immediately invalidates all of your old codes.

Store recovery codes somewhere other than your phone, such as a password manager or a printed copy kept in a safe place.

## If you lose your phone or security key

If you still have a recovery code, sign in with it. Then go to the 2FA settings, turn 2FA off, and set it up again on your new device.

If you have no recovery codes left:

1. Go to lumen-notes.example/recover and submit an account recovery request.
2. We verify your identity using details such as your account email, recent invoice numbers, and workspace names. Verification takes 3 to 5 business days.
3. Once approved, 2FA is removed after a 72-hour security hold, and we email every address on the account so the real owner can stop the request.

Workspace admins cannot turn off 2FA for another person. Only the recovery process above can remove it.

## Active sessions and devices

To see where you are signed in, go to **Settings > Account > Security > Active sessions**. Each entry shows the device type, the app, the approximate location, and when it was last active.

- To sign out one device, select **Sign out** next to it.
- To sign out everywhere except the device you are using, select **Sign out of all other sessions**.

Sessions also end on their own after a period without activity: 30 days for the web app, and 90 days for the desktop and mobile apps.

When you sign out a device, any offline copies of your notes on that device are deleted the next time it connects to the internet.

## Sign-in alerts and lockouts

We email you whenever your account is signed in on a new device or browser. If you do not recognize the sign-in, change your password and sign out of all other sessions.

After 10 failed sign-in attempts in a row, your account is locked for 15 minutes. To unlock it sooner, reset your password.

To report suspicious activity, email security@lumen-notes.example. The security team reviews reports within 24 hours.

## Changing your email address

1. Go to **Settings > Account > Profile > Email address**.
2. Enter the new address and your current password.
3. Open the confirmation email sent to the new address. The link is valid for 24 hours.

Your old address receives a notice with a link to cancel the change. That link works for 7 days.
