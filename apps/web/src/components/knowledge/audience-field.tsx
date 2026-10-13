"use client";

import type { Audience } from "@docent/api-client";
import { Field } from "@/components/ui/field";
import { Select } from "@/components/ui/select";

/** Who the agent may answer from this content for. Submits as `audience`. */
export function AudienceField({ defaultValue = "public", error }: { defaultValue?: Audience; error?: string }) {
  return (
    <Field
      label="Who can get answers from it"
      error={error}
      hint="Signed-in customers see everything. Anonymous visitors only see content for everyone."
    >
      <Select name="audience" defaultValue={defaultValue}>
        <option value="public">Everyone</option>
        <option value="identified">Signed-in customers only</option>
      </Select>
    </Field>
  );
}

export function readAudience(data: FormData): Audience {
  return data.get("audience") === "identified" ? "identified" : "public";
}
