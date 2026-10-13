# Integrations

Lumen Notes connects to your calendar, your team chat, and your browser, and offers a REST API for your own scripts. You manage all integrations under **Settings > Integrations**.

## Calendar

Connect a calendar to turn events into meeting notes.

1. Go to **Settings > Integrations > Calendar** and select **Connect**.
2. Enter a CalDAV server address with your calendar username and password, or paste an ICS subscription link.
3. Choose which calendars to show. You can connect up to 3 calendars per account.

Lumen only reads your calendar. It never creates, changes, or deletes events. Connected calendars refresh every 15 minutes.

To create a meeting note, open the **Today** panel, select an event, and select **Create meeting note**. The note is filled in with the event title, date, and attendee list. Turn on **Auto-create meeting notes** to have Lumen create one 10 minutes before every event that has at least 2 attendees.

## Rookery Chat

The Rookery Chat integration is available on Team and Enterprise workspaces.

To install it, go to **Settings > Integrations > Rookery Chat** and select **Add to Rookery**. An administrator of your Rookery Chat organization has to approve the request.

Once installed:

- **Link previews**: when someone pastes a Lumen link in a channel, Rookery shows the note title and its first 200 characters. The preview only appears for people who also have access to the note in Lumen.
- **Slash command**: type `/lumen new Title` to create a note in your default notebook, or `/lumen search term` to search your workspace.
- **Notebook updates**: to post a summary to a channel whenever notes in a notebook are created or changed, open the notebook and select **... > Notifications > Send to Rookery channel**. Updates are grouped and posted every 30 minutes.

## Web clipper

The web clipper is a browser extension for desktop browsers. Install it from lumen-notes.example/clipper and sign in with your Lumen account.

You can clip a page in five ways:

- **Full page**: the whole page as it looks in your browser.
- **Simplified article**: the main text and images, without menus and ads.
- **Selection**: only the text you highlighted.
- **Screenshot**: an image of the visible area.
- **Bookmark**: the title, link, and a short summary.

Clips are saved to a notebook called **Clipped** in your personal workspace. To change the destination, open the extension options. The keyboard shortcut to clip is Alt+Shift+L (Option+Shift+L on Mac).

On the Free plan you can save 50 clips per month. Paid plans have no clip limit.

## API tokens

Use the Lumen REST API to read and write notes from your own scripts. API access is available on Plus, Team, and Enterprise.

To create a personal API token:

1. Go to **Settings > Integrations > API tokens** and select **Create token**.
2. Give it a name and choose its scopes: `notes:read`, `notes:write`, or `workspace:admin` (admins only).
3. Choose an expiry of 30, 90, or 365 days. The default is 90 days. Tokens without an expiry date are not supported.
4. Copy the token. It starts with `lnpat_` and is shown only once.

Send the token in the `Authorization: Bearer` header to the base URL https://api.lumen-notes.example/v2.

Each user can have up to 20 active tokens. Each token can make 120 requests per minute. Requests over that limit get HTTP status 429 with a `Retry-After` header that says how many seconds to wait.

To revoke a token, select it in the list and select **Revoke**. It stops working immediately.

## Managing connected apps

Third-party apps that you authorized to access your Lumen account are listed under **Settings > Integrations > Connected apps**, with the date each one last used your account.

Select **Disconnect** to remove an app's access immediately. Apps that have not been used for 180 days are disconnected automatically, and we email you when that happens.
