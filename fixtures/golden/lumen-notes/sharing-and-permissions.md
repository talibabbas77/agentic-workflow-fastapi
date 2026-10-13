# Sharing and permissions

You can share a single note, a notebook, or a whole workspace. This page explains the permission levels, workspace roles, public links, and how to remove someone's access.

## Permission levels

Each person you share with gets one of four permission levels:

| Level | View | Comment | Edit | Share and change permissions | Delete |
|---|---|---|---|---|---|
| Full access | Yes | Yes | Yes | Yes | Yes |
| Can edit | Yes | Yes | Yes | No | No |
| Can comment | Yes | Yes | No | No | No |
| Can view | Yes | No | No | No | No |

New invitations default to **Can edit**. You can change the default for your workspace under **Settings > Workspace > Sharing defaults**.

## Share a note or notebook

1. Open the note or notebook and select **Share** in the top-right corner.
2. Enter names or email addresses. You can invite up to 50 people at once.
3. Choose a permission level and select **Invite**.

People who do not have a Lumen Notes account receive an email invitation. Invitations expire after 14 days. You can resend an expired invitation from the same Share panel.

Notes inherit the permissions of the notebook they are in. You can give someone more access to a single note than they have to its notebook, but not less. To keep a note away from people who can see the rest of the notebook, move the note to a different notebook.

## Workspace roles

Workspace roles control what people can do across the whole workspace, separate from permissions on individual notes.

| Role | What they can do |
|---|---|
| Owner | Everything, including billing and deleting the workspace. Each workspace has exactly one owner. |
| Admin | Manage members, guests, and security settings, and open every notebook in the workspace. |
| Member | Create notebooks and share any content they have Full access to. |
| Guest | Open only the notebooks and notes shared with them. Guests cannot create notebooks or see the member list, and they cannot be given Full access. |

### Transferring ownership

Only the current owner can transfer ownership, and the new owner must already be an admin.

1. Go to **Settings > Workspace > Members**.
2. Select the admin who will become the owner, then select **Make owner**.
3. Confirm with your password.

After the transfer, the previous owner becomes an admin.

## Public links

A public link lets anyone with the URL read a note without signing in.

1. Open the note and select **Share > Publish to web**.
2. Turn on **Publish**. Lumen creates a read-only link at share.lumen-notes.example followed by a unique ID.

By default, search engines are asked not to index published notes. Turn on **Allow search engines** if you want the page to be findable.

On Plus, Team, and Enterprise, you can also protect a public link with a password and set an expiry date up to 365 days in the future.

To unpublish, turn **Publish** off. The link stops working within 1 minute. Admins can turn off public links for the entire workspace under **Settings > Workspace > Security > Public links**.

## Removing access

To remove one person from a note or notebook, open **Share**, select their name, and select **Remove**.

To remove someone from the workspace entirely, go to **Settings > Workspace > Members**, select **...** next to their name, and select **Remove from workspace**. When you do:

- They lose access immediately. Offline copies on their devices are deleted the next time their app connects.
- Notebooks they had shared with others stay in the workspace unchanged.
- Their private notebooks move to a notebook called "Former member: name", which only admins can see. It is kept for 30 days and then deleted.

## Requesting access

If you open a link to a note you do not have permission to see, select **Request access**. The request is sent to everyone with Full access to that note. If nobody responds within 7 days, the request expires and you need to send a new one.

People with Full access can approve a request from the email or from the notification bell. When approving, they choose your permission level.
