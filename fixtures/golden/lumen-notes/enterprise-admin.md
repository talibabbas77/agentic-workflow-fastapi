# Enterprise administration

This guide is for owners and admins of Lumen Notes Enterprise workspaces. It covers single sign-on, user provisioning, the audit log, data residency, and security policies. The features described here are available only on the Enterprise plan.

## The admin console

Open the admin console from **Settings > Admin console**. Enterprise workspaces have two extra admin roles in addition to Owner and Admin:

| Role | Can manage |
|---|---|
| Security admin | SSO, SCIM, the audit log, and security policies. Cannot see billing or open private notebooks. |
| Billing admin | Invoices, payment details, and seat counts. Cannot change security settings. |

Assign these roles under **Admin console > Members > Roles**.

## Configuring SAML single sign-on

Lumen Notes supports SAML 2.0 with any identity provider (IdP) that can send signed assertions.

1. **Verify your domain.** Go to **Admin console > Domains > Add domain** and add the DNS TXT record shown, which starts with `lumen-verification=`. We check for the record every 10 minutes for up to 72 hours. You can verify up to 10 domains per workspace.
2. Go to **Admin console > Authentication > SAML SSO** and select **Configure**.
3. In your IdP, create an application using these values:
   - ACS URL: `https://auth.lumen-notes.example/saml/<workspace-id>/acs`
   - Entity ID: `https://auth.lumen-notes.example/saml/<workspace-id>`
   - NameID format: email address
4. Upload your IdP metadata XML file, or paste the IdP sign-in URL and X.509 signing certificate.
5. Select **Test connection** and sign in through your IdP.

Assertions must be signed with SHA-256. Lumen reads the `email` attribute (required) and the optional `firstName`, `lastName`, and `groups` attributes.

## Enforcing SSO

After a successful test, turn on **Admin console > Authentication > Require SSO**. When SSO is required:

- Members whose email address is on a verified domain must sign in through your IdP. Password sign-in is turned off for them.
- Existing sessions stay active until they expire. To end them right away, select **Sign out all members now**.
- The owner keeps password sign-in with 2FA as a break-glass account in case the IdP is unavailable. You can name one more break-glass admin, for a maximum of 2.
- Guests whose email addresses are outside your verified domains keep signing in with a password.

Just-in-time provisioning is off by default. When you turn it on, anyone from a verified domain who signs in through SSO without an existing account is added to the workspace as a Member.

## SCIM provisioning

Use SCIM 2.0 to create, update, and deactivate users from your IdP automatically.

- **Base URL**: `https://api.lumen-notes.example/scim/v2`
- **Token**: go to **Admin console > Provisioning** and select **Generate SCIM token**. The token is shown once and does not expire. A workspace has one active SCIM token at a time. When you generate a new one, the old token keeps working for 24 hours and then stops.
- **Groups**: groups pushed from your IdP appear as Lumen groups, which you can add to notebooks like individual people.
- **Rate limit**: 300 SCIM requests per minute per workspace.

When a user is deactivated in your IdP, Lumen suspends them immediately and ends all of their sessions. Suspended users keep their content and can be reactivated. If you delete the user in your IdP, Lumen permanently deletes the account 30 days later and transfers notebooks they owned to the workspace owner.

## Audit log

The audit log records security and administration events, including sign-ins and failed sign-ins, SSO and SCIM changes, members added or removed, permission changes, public links created, exports, and API tokens created or revoked.

- Events appear in **Admin console > Audit log** within 5 minutes.
- Events are retained for 2 years and then deleted.
- You can export events to CSV for any date range of up to 90 days per export.
- To send events to your security monitoring system as they happen, go to **Audit log > Streaming** and add an HTTPS endpoint. Events are delivered as JSON.

## Data residency

Enterprise workspaces can store data in one of three regions: United States, European Union, or Australia. You choose the region when the workspace is created.

Stored in your region: note content, attachments, search indexes, backups, and the audit log. Not stored in your region: the name and email address on each account, which are kept in a global directory so people can sign in, and billing records.

To move an existing workspace to another region, ask your named support contact. A region move takes up to 14 days to complete and includes one read-only window of up to 4 hours, scheduled with you in advance.

## Session and network policies

Under **Admin console > Security > Policies**, you can:

- Shorten the web session length to anywhere from 1 to 30 days.
- Block attachment downloads on mobile devices.
- Restrict access to an IP allowlist of up to 50 CIDR ranges. People outside the allowlist see an access denied page, except break-glass accounts.
