"use client";

import type { SigningKey } from "@docent/api-client";
import { CheckIcon, DownloadSimpleIcon, KeyIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogFooter } from "@/components/ui/dialog";
import { Field, Textarea } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { api, request } from "@/lib/api/browser";
import { downloadText, generateSigningKey, privateKeyPem, publicJwkFromPem, type PublicJwk } from "@/lib/signing-keys";
import { useApiForm } from "@/lib/use-api-form";

const ways = [
  { value: "generate", label: "Generate in this browser" },
  { value: "upload", label: "Use my own public key" },
] as const;

type Way = (typeof ways)[number]["value"];

const TOO_MANY = "This widget already has two active keys. Retire one, then add the new key.";

/**
 * Add a signing key. Generating one keeps the private half in this tab's memory
 * only, until it is downloaded once; closing the dialog drops it. Mount with a
 * new key per opening for fresh state.
 */
export function AddKeyDialog({
  widgetId,
  open,
  onClose,
  onAdded,
}: {
  widgetId: string;
  open: boolean;
  onClose: () => void;
  /** Called as soon as the API has the key; the dialog may stay open for the download. */
  onAdded: (key: SigningKey, way: Way) => void;
}) {
  const form = useApiForm();
  const [way, setWay] = useState<Way>("generate");
  const [pem, setPem] = useState("");
  const [pemError, setPemError] = useState<string | null>(null);
  const [generated, setGenerated] = useState<{ kid: string; privateKey: CryptoKey | null } | null>(null);
  const [downloaded, setDownloaded] = useState(false);

  function close() {
    // Drop the private key with the dialog; it is never stored anywhere.
    setGenerated((current) => (current ? { kid: current.kid, privateKey: null } : null));
    onClose();
  }

  const upload = (publicJwk: PublicJwk) =>
    request(
      api.POST("/v1/widgets/{widget_id}/keys", {
        params: { path: { widget_id: widgetId } },
        body: { public_jwk: publicJwk },
      }),
    );

  async function generate() {
    let pair: Awaited<ReturnType<typeof generateSigningKey>>;
    try {
      pair = await generateSigningKey();
    } catch {
      form.check({
        key: "This browser could not create a key. Use a current version of Chrome, Edge, Firefox, or Safari.",
      });
      return;
    }
    await form.run(
      () => upload(pair.publicJwk),
      (key) => {
        setGenerated({ kid: key.kid, privateKey: pair.privateKey });
        onAdded(key, "generate");
      },
    );
  }

  async function addOwn() {
    setPemError(null);
    let publicJwk: PublicJwk;
    try {
      publicJwk = await publicJwkFromPem(pem);
    } catch (error) {
      setPemError(error instanceof Error ? error.message : "This key could not be read.");
      return;
    }
    await form.run(
      () => upload(publicJwk),
      (key) => onAdded(key, "upload"),
    );
  }

  async function download() {
    if (!generated?.privateKey) return;
    downloadText(`docent-${generated.kid}.pem`, await privateKeyPem(generated.privateKey));
    setDownloaded(true);
  }

  const topError =
    form.error?.code === "too_many_keys" ? TOO_MANY : form.error?.code === "invalid_key" ? null : form.formError;
  const keyError = pemError ?? (form.error?.code === "invalid_key" ? form.error.message : form.fieldError("key"));

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (way === "generate") await generate();
    else await addOwn();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={generated ? "Key added" : "Add a signing key"}
      description={
        generated
          ? "Signed-in customers can use it as soon as your server signs with it."
          : "Your server signs each customer's token with the private key. Docent checks it with the public key."
      }
    >
      {generated ? (
        <>
          <DialogBody className="flex flex-col gap-5">
            <div className="flex items-center gap-3 rounded-md border border-line bg-paper px-4 py-3">
              <KeyIcon aria-hidden="true" className="size-4.5 shrink-0 text-ink-muted" />
              <div className="flex min-w-0 flex-col">
                <span className="text-sm text-ink-muted">Key id</span>
                <span className="truncate font-mono text-base text-ink">{generated.kid}</span>
              </div>
            </div>
            <div
              role="note"
              className="flex items-start gap-2.5 rounded-md border border-rust/40 bg-rust-soft px-3.5 py-3 text-base text-ink"
            >
              <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-4.5 shrink-0 text-rust" weight="bold" />
              <p>
                <span className="font-medium">Download the private key now.</span> It was made in this browser.
                Docent never sees or stores it, so it cannot be shown again. Keep it on your server as{" "}
                <code className="font-mono text-sm">DOCENT_PRIVATE_KEY</code>.
              </p>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant={downloaded ? "primary" : "secondary"} onClick={close}>
              Done
            </Button>
            <Button
              variant={downloaded ? "secondary" : "primary"}
              onClick={download}
              icon={
                downloaded ? (
                  <CheckIcon aria-hidden="true" className="size-4" />
                ) : (
                  <DownloadSimpleIcon aria-hidden="true" className="size-4" />
                )
              }
            >
              {downloaded ? "Downloaded" : "Download private key"}
            </Button>
          </DialogFooter>
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <DialogBody className="flex flex-col gap-5">
            {topError ? <FormAlert>{topError}</FormAlert> : null}
            <SegmentedControl legend="How" name="key-way" value={way} options={ways} onChange={setWay} />
            {way === "generate" ? (
              <div className="flex flex-col gap-2 text-base text-ink-muted">
                <p>
                  Your browser creates an ES256 key pair and sends Docent only the public key. You then download the
                  private key once.
                </p>
                {keyError ? (
                  <p className="flex items-start gap-1.5 text-sm text-rust">
                    <WarningCircleIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" weight="bold" />
                    <span>{keyError}</span>
                  </p>
                ) : null}
              </div>
            ) : (
              <Field
                label="Public key"
                error={keyError ?? undefined}
                hint={
                  <>
                    The contents of <code className="font-mono">docent-public.pem</code> from the commands in the
                    install guide. Never paste the private key.
                  </>
                }
              >
                <Textarea
                  value={pem}
                  onChange={(event) => {
                    setPem(event.target.value);
                    setPemError(null);
                  }}
                  rows={5}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={"-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"}
                  className="font-mono"
                  autoFocus
                />
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" loading={form.pending} disabled={way === "upload" && !pem.trim()}>
              {way === "generate" ? "Generate key" : "Add key"}
            </Button>
          </DialogFooter>
        </form>
      )}
    </Dialog>
  );
}
