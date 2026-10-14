/**
 * Typed client for the Docent API. Types are generated from the FastAPI
 * OpenAPI schema with `pnpm api:types`; never edit schema.d.ts by hand.
 */
import createClient from "openapi-fetch";
import type { components, paths } from "./schema";

export type { components, paths };

type Schemas = components["schemas"];

export type Me = Schemas["MeOut"];
export type User = Schemas["UserOut"];
export type TenantSummary = Schemas["TenantSummary"];
export type Tenant = Schemas["TenantOut"];
export type Member = Schemas["MemberOut"];
export type Invitation = Schemas["InvitationOut"];
export type Members = Schemas["MembersOut"];
export type InvitationLookup = Schemas["InvitationLookupOut"];
export type Onboarding = Schemas["OnboardingOut"];
export type OnboardingStep = Schemas["OnboardingStep"];
export type Role = Schemas["MemberOut"]["role"];
export type ApiError = Schemas["ErrorDetail"];
export type Source = Schemas["SourceOut"];
export type Sources = Schemas["SourcesOut"];
export type SourceDetail = Schemas["SourceDetailOut"];
export type KnowledgeDocument = Schemas["DocumentOut"];
export type SearchHit = Schemas["SearchHitOut"];
export type SearchResult = Schemas["SearchOut"];
export type Audience = Schemas["SourceOut"]["audience"];
export type Plan = Schemas["Plan"];
export type AgentSettings = Schemas["AgentSettingsOut"];
export type Tone = Schemas["AgentSettingsOut"]["tone"];
export type Conversation = Schemas["ConversationOut"];
export type ConversationMode = Schemas["ConversationOut"]["mode"];
export type ChatMessage = Schemas["MessageOut"];
export type Citation = Schemas["CitationOut"];
export type Escalation = Schemas["EscalationOut"];
export type EscalationSummary = Schemas["EscalationSummaryOut"];
export type TicketType = Schemas["TicketTypeOut"];
export type TicketTypeInput = Schemas["TicketTypeIn"];
export type TicketField = Schemas["TicketField"];
export type Widget = Schemas["WidgetOut"];
export type WidgetInput = Schemas["WidgetIn"];
export type SigningKey = Schemas["SigningKeyOut"];
export type Billing = Schemas["BillingOut"];
export type UsageMeter = Schemas["UsageMeter"];
export type PaidPlanId = Schemas["CheckoutIn"]["plan_id"];
export type PlanChangePreview = Schemas["PlanChangePreviewOut"];
export type ChargeLine = Schemas["ChargeLine"];
export type RefundStatus = Schemas["RefundOut"];
export type MemoryOverview = Schemas["MemoryOverviewOut"];
export type MemorySource = Schemas["MemorySourceOut"];
export type CitedSection = Schemas["CitedSectionOut"];
export type TeamAnswer = Schemas["TeamAnswerOut"];
export type TeamAnswerInput = Schemas["TeamAnswerIn"];
export type GapGroup = Schemas["GapGroupOut"];
export type RememberedCustomer = Schemas["RememberedCustomerOut"];
export type RememberedCustomerDetail = Schemas["RememberedCustomerDetailOut"];
export type CustomerFact = Schemas["CustomerFactOut"];
export type InboxItem = Schemas["InboxItemOut"];
export type InboxCounts = Schemas["InboxCountsOut"];
export type InboxPage = Schemas["InboxPageOut"];
export type InboxBoard = Schemas["InboxBoardOut"];
export type BoardColumn = Schemas["BoardColumnOut"];
export type InboxDetail = Schemas["InboxDetailOut"];
export type InboxMessage = Schemas["InboxMessageOut"];
export type InboxUpdate = Schemas["InboxUpdateIn"];
export type InboxStats = Schemas["InboxStatsOut"];
export type InboxSettings = Schemas["InboxSettingsOut"];
export type HandoffStatus = Schemas["InboxItemOut"]["status"];
export type HandoffReason = Schemas["InboxItemOut"]["reason"];
export type Priority = Schemas["InboxItemOut"]["priority"];
export type Assignee = Schemas["AssigneeOut"];
export type HandoffNote = Schemas["NoteOut"];
export type HistoryEntry = Schemas["HistoryEntryOut"];
export type EmailDelivery = Schemas["EmailDeliveryOut"];
export type HandoffCustomer = Schemas["CustomerOut"];
export type NotificationPrefs = Schemas["NotificationPrefs"];
export type RoutingRule = Schemas["RoutingRuleOut"];
export type RoutingRuleInput = Schemas["RoutingRuleIn"];
export type ClaimCondition = Schemas["ClaimCondition"];
export type SlackChannel = Schemas["SlackChannelOut"];
export type NotificationState = Schemas["NotificationStateOut"];
export type Webhook = Schemas["WebhookOut"];
export type WebhookEvent = Schemas["WebhookOut"]["events"][number];
export type WebhookDelivery = Schemas["WebhookDeliveryOut"];

export interface ApiClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
}

export function createApiClient(options: ApiClientOptions) {
  return createClient<paths>({
    baseUrl: options.baseUrl,
    headers: options.headers,
    fetch: options.fetch,
    credentials: "include",
  });
}

export type ApiClient = ReturnType<typeof createApiClient>;

/** Pull the API error out of an openapi-fetch error value, whatever its shape. */
export function toApiError(error: unknown, status?: number): ApiError {
  if (error && typeof error === "object" && "error" in error) {
    const inner = (error as { error: unknown }).error;
    if (inner && typeof inner === "object" && "code" in inner && "message" in inner) {
      return inner as ApiError;
    }
  }
  return {
    code: status === 429 ? "rate_limited" : "unknown_error",
    message:
      status === 429
        ? "Too many attempts. Try again shortly."
        : "Something went wrong. Try again.",
  };
}
