"use client";

import type { AgentSettings, Tone } from "@docent/api-client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ChipField } from "@/components/ui/chip-field";
import { Field, Input } from "@/components/ui/field";
import { FormAlert } from "@/components/ui/form-alert";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/toast";
import { api, request } from "@/lib/api/browser";
import { useApiForm } from "@/lib/use-api-form";

const tones = [
  { value: "friendly", label: "Friendly" },
  { value: "neutral", label: "Neutral" },
  { value: "formal", label: "Formal" },
] as const satisfies readonly { value: Tone; label: string }[];

const MAX_TOPICS = 30;

export function AgentSettingsForm({ initial, canEdit }: { initial: AgentSettings; canEdit: boolean }) {
  const toast = useToast();
  const form = useApiForm();
  const [saved, setSaved] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [tone, setTone] = useState<Tone>(initial.tone);
  const [topics, setTopics] = useState(initial.restricted_topics);

  const changed =
    name.trim() !== saved.name ||
    tone !== saved.tone ||
    topics.length !== saved.restricted_topics.length ||
    topics.some((topic, index) => topic !== saved.restricted_topics[index]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!form.check({ name: !trimmed && "Give the agent a name." })) return;
    await form.run(
      () => request(api.PATCH("/v1/agent/settings", { body: { name: trimmed, tone, restricted_topics: topics } })),
      (data) => {
        setSaved(data);
        setName(data.name);
        setTone(data.tone);
        setTopics(data.restricted_topics);
        toast({ tone: "success", title: "Agent settings saved", description: "The next answer uses them." });
      },
    );
  }

  return (
    <Card aria-labelledby="agent-settings-heading">
      <CardHeader>
        <CardTitle id="agent-settings-heading">Settings</CardTitle>
        <CardDescription>
          {canEdit
            ? "How the agent sounds, and what it always passes to your team."
            : "Only owners and admins can change these."}
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit} noValidate>
        <CardBody className="flex flex-col gap-6">
          {form.formError ? <FormAlert>{form.formError}</FormAlert> : null}
          <Field label="Name" error={form.fieldError("name")} hint="The name the agent uses for itself.">
            <Input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              readOnly={!canEdit}
              maxLength={120}
              autoComplete="off"
            />
          </Field>
          <SegmentedControl
            legend="Tone"
            name="tone"
            value={tone}
            options={tones}
            onChange={setTone}
            disabled={!canEdit}
            hint="Changes how answers sound, never what they say."
          />
          <ChipField
            label="Restricted topics"
            values={topics}
            onChange={setTopics}
            readOnly={!canEdit}
            max={MAX_TOPICS}
            maxLength={80}
            validate={(topic) => (topic.length < 2 ? "Use at least 2 characters." : null)}
            placeholder="Type a word or phrase, then Enter"
            error={form.fieldError("restricted_topics")}
            hint="A message that mentions one of these goes to your team without an answer. Legal threats, payment disputes, account deletion, and security reports always do."
          />
        </CardBody>
        {canEdit ? (
          <CardFooter>
            <Button type="submit" loading={form.pending} disabled={!changed}>
              Save changes
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}
