import type { OutcomeSemanticClass } from "../authority/job.js";

export interface SemanticOutcomeCatalogEntry {
  readonly alias: string;
  readonly semanticClass: OutcomeSemanticClass;
  readonly provider: string;
  readonly supported: boolean;
}

/** The stable product vocabulary. Provider packs map into these classes; they do not redefine them. */
export const semanticOutcomeCatalog: readonly SemanticOutcomeCatalogEntry[] = Object.freeze([
  { alias: "github_issue_labels_set_v1", semanticClass: "record_state_set_v1", provider: "github", supported: true },
  { alias: "slack_channel_topic_set_v1", semanticClass: "record_state_set_v1", provider: "slack", supported: true },
  { alias: "gmail_reply_send_v1", semanticClass: "communication_commit_v1", provider: "gmail", supported: true },
  { alias: "gmail_thread_labels_set_v1", semanticClass: "record_state_set_v1", provider: "gmail", supported: true },
  { alias: "stripe_refund_issue_v1", semanticClass: "money_refund_v1", provider: "stripe", supported: true },
  { alias: "vercel_deployment_release_v1", semanticClass: "deployment_release_v1", provider: "vercel", supported: true },
  { alias: "cloudflare_dns_record_set_v1", semanticClass: "infrastructure_resource_set_v1", provider: "cloudflare", supported: true },
  { alias: "hubspot_ticket_stage_set_v1", semanticClass: "record_state_set_v1", provider: "hubspot", supported: false },
  { alias: "google_calendar_event_set_v1", semanticClass: "schedule_commit_v1", provider: "google-calendar", supported: false },
  { alias: "google_drive_artifact_publish_v1", semanticClass: "artifact_deliver_v1", provider: "google-drive", supported: false },
  { alias: "commerce_purchase_commit_v1", semanticClass: "commerce_purchase_commit_v1", provider: "acp-ucp-ap2", supported: false },
]);

export function semanticOutcomeForAlias(alias: string): SemanticOutcomeCatalogEntry | undefined {
  return semanticOutcomeCatalog.find(entry => entry.alias === alias);
}
