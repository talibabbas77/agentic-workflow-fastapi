"use client";

import type { Invitation, Me, Member, Members, Role } from "@docent/api-client";
import { EnvelopeSimpleIcon, UserPlusIcon } from "@phosphor-icons/react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Avatar } from "@/components/ui/avatar";
import { Badge, RoleBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { formatDate, roleLabel } from "@/lib/format";
import { hardNavigate } from "@/lib/navigation";
import { useApiForm } from "@/lib/use-api-form";

type Confirm = { member: Member; leaving: boolean } | null;

export function MembersManager({ data, me }: { data: Members; me: Me }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const toast = useToast();
  const [inviteOpen, setInviteOpen] = useState(() => params.get("invite") === "1");
  const [inviteKey, setInviteKey] = useState(0);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [resets, setResets] = useState(0);

  const myRole: Role = me.active_tenant?.role ?? "agent";
  const workspace = me.active_tenant?.name ?? "this workspace";
  const isOwner = myRole === "owner";

  function canRemove(member: Member) {
    if (member.is_you) return true;
    if (myRole === "owner") return true;
    return myRole === "admin" && member.role === "agent";
  }

  function openInvite() {
    setInviteKey((k) => k + 1);
    setInviteOpen(true);
  }

  function closeInvite() {
    setInviteOpen(false);
    if (params.get("invite")) router.replace(pathname, { scroll: false });
  }

  async function changeRole(member: Member, role: Role) {
    setBusy(member.user_id);
    const result = await request(
      api.PATCH("/v1/members/{user_id}", { params: { path: { user_id: member.user_id } }, body: { role } }),
    );
    setBusy(null);
    if (result.ok) {
      toast({ tone: "success", title: `${member.name} is now ${roleLabel[role].toLowerCase()}` });
      router.refresh();
    } else {
      setResets((n) => n + 1);
      toast({ tone: "error", title: "Role not changed", description: result.error.message });
    }
  }

  async function revoke(invitation: Invitation) {
    setBusy(invitation.id);
    const result = await request(
      api.DELETE("/v1/invitations/{invitation_id}", { params: { path: { invitation_id: invitation.id } } }),
    );
    setBusy(null);
    if (result.ok) {
      toast({ tone: "success", title: "Invitation revoked", description: invitation.email });
      router.refresh();
    } else {
      toast({ tone: "error", title: "Could not revoke the invitation", description: result.error.message });
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <Card aria-labelledby="members-heading">
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-1">
            <CardTitle id="members-heading">Members</CardTitle>
            <CardDescription>
              {data.members.length} {data.members.length === 1 ? "person has" : "people have"} access to {workspace}.
            </CardDescription>
          </div>
          <Button onClick={openInvite} icon={<UserPlusIcon aria-hidden="true" className="size-4" />}>
            Invite teammate
          </Button>
        </CardHeader>

        <div className="relative overflow-x-auto">
          <table className="w-full text-left text-base max-sm:block">
            <thead className="max-sm:hidden">
              <tr className="border-b border-line text-sm text-ink-muted">
                <th scope="col" className="px-6 py-2.5 font-medium">
                  Name
                </th>
                <th scope="col" className="w-40 px-3 py-2.5 font-medium">
                  Role
                </th>
                <th scope="col" className="hidden w-36 px-3 py-2.5 font-medium md:table-cell">
                  Joined
                </th>
                <th scope="col" className="w-28 px-6 py-2.5">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="max-sm:block">
              {data.members.map((member) => (
                <tr
                  key={member.user_id}
                  className="border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-surface-2/60 max-sm:flex max-sm:flex-wrap max-sm:items-center max-sm:gap-x-3 max-sm:gap-y-3 max-sm:px-6 max-sm:py-4"
                >
                  <td className="px-6 py-3 max-sm:w-full max-sm:p-0">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={member.name} seed={member.user_id} />
                      <div className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink">{member.name}</span>
                          {member.is_you ? <Badge tone="outline">You</Badge> : null}
                        </span>
                        <span className="truncate text-sm text-ink-muted">{member.email}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3 max-sm:p-0 max-sm:pl-11">
                    {isOwner ? (
                      <Select
                        key={`${member.role}-${resets}`}
                        size="sm"
                        aria-label={`Role for ${member.name}`}
                        defaultValue={member.role}
                        disabled={busy === member.user_id}
                        onChange={(event) => changeRole(member, event.target.value as Role)}
                        className="w-32"
                      >
                        <option value="owner">Owner</option>
                        <option value="admin">Admin</option>
                        <option value="agent">Agent</option>
                      </Select>
                    ) : (
                      <RoleBadge role={member.role} />
                    )}
                  </td>
                  <td className="hidden px-3 py-3 text-ink-muted md:table-cell">
                    {formatDate(member.joined_at)}
                  </td>
                  <td className="px-6 py-3 text-right max-sm:ml-auto max-sm:p-0">
                    {canRemove(member) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setConfirm({ member, leaving: member.is_you })}
                      >
                        {member.is_you ? "Leave" : "Remove"}
                        <span className="sr-only"> {member.name}</span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card aria-labelledby="invitations-heading">
        <CardHeader>
          <CardTitle id="invitations-heading">Pending invitations</CardTitle>
          <CardDescription>Invitations expire after 7 days. Revoke one to disable its link.</CardDescription>
        </CardHeader>
        {data.invitations.length === 0 ? (
          <div className="flex items-center gap-3 px-6 py-6 text-base text-ink-muted">
            <EnvelopeSimpleIcon aria-hidden="true" className="size-5 text-ink-subtle" />
            No pending invitations.
          </div>
        ) : (
          <ul>
            {data.invitations.map((invitation) => (
              <li
                key={invitation.id}
                className="flex flex-col gap-3 border-b border-line px-6 py-3.5 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-muted"
                  >
                    <EnvelopeSimpleIcon className="size-4" />
                  </span>
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{invitation.email}</span>
                      <RoleBadge role={invitation.role} />
                    </span>
                    <span className="text-sm text-ink-muted">
                      {invitation.invited_by_name ? `Invited by ${invitation.invited_by_name}. ` : ""}
                      Expires {formatDate(invitation.expires_at)}.
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="self-start max-sm:ml-8 sm:self-auto"
                  loading={busy === invitation.id}
                  onClick={() => revoke(invitation)}
                >
                  Revoke
                  <span className="sr-only"> invitation for {invitation.email}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <InviteDialog
        key={inviteKey}
        open={inviteOpen}
        onClose={closeInvite}
        onInvited={(email) => {
          closeInvite();
          toast({ tone: "success", title: "Invitation sent", description: email });
          router.refresh();
        }}
        workspace={workspace}
      />

      <ConfirmRemove
        confirm={confirm}
        workspace={workspace}
        onClose={() => setConfirm(null)}
        onDone={(leaving, name) => {
          setConfirm(null);
          if (leaving) return hardNavigate("/app");
          toast({ tone: "success", title: `${name} was removed` });
          router.refresh();
        }}
      />
    </div>
  );
}

function InviteDialog({
  open,
  onClose,
  onInvited,
  workspace,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: (email: string) => void;
  workspace: string;
}) {
  const form = useApiForm();

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "").trim();
    const role = data.get("role") === "admin" ? "admin" : "agent";
    if (!form.check({ email: !email && "Enter their work email." })) return;
    await form.run(
      () => request(api.POST("/v1/invitations", { body: { email, role } })),
      () => onInvited(email),
    );
  }

  const emailError =
    form.fieldError("email") ?? (form.error?.code === "already_member" ? form.error.message : undefined);
  const topError = form.error?.code === "already_member" ? null : form.formError;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Invite a teammate"
      description={`They get an email with a link to join ${workspace}.`}
    >
      <form onSubmit={onSubmit} noValidate>
        <DialogBody className="flex flex-col gap-5">
          {topError ? <FormAlert>{topError}</FormAlert> : null}
          <Field label="Work email" error={emailError}>
            <Input name="email" type="email" autoComplete="off" inputMode="email" autoFocus />
          </Field>
          <Field
            label="Role"
            error={form.fieldError("role")}
            hint="Agents answer conversations. Admins also manage settings and members."
          >
            <Select name="role" defaultValue="agent">
              <option value="agent">Agent</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={form.pending}>
            Send invitation
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

function ConfirmRemove({
  confirm,
  workspace,
  onClose,
  onDone,
}: {
  confirm: Confirm;
  workspace: string;
  onClose: () => void;
  onDone: (leaving: boolean, name: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keep the last target so the text does not vanish while the dialog fades out.
  const [last, setLast] = useState(confirm);
  if (confirm && confirm !== last) {
    setLast(confirm);
    setError(null);
  }
  const target = confirm ?? last;
  const leaving = target?.leaving ?? false;
  const name = target?.member.name ?? "";

  async function remove() {
    if (!target) return;
    setPending(true);
    setError(null);
    const result = await request(
      api.DELETE("/v1/members/{user_id}", { params: { path: { user_id: target.member.user_id } } }),
    );
    setPending(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    onDone(leaving, name);
  }

  return (
    <Dialog
      open={confirm !== null}
      onClose={onClose}
      title={leaving ? `Leave ${workspace}?` : `Remove ${name}?`}
      description={
        leaving
          ? "You lose access right away. A teammate can invite you again later."
          : `${name} loses access to ${workspace} right away. You can invite them again later.`
      }
    >
      {error ? (
        <DialogBody className="pt-4 pb-2">
          <FormAlert>{error}</FormAlert>
        </DialogBody>
      ) : (
        <div className="h-5" />
      )}
      <DialogFooter>
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" loading={pending} onClick={remove}>
          {leaving ? "Leave workspace" : "Remove"}
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
