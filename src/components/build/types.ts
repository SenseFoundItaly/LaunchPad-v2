// Shared client-side shapes for the Build & Launch hub (mirror the API rows).

export interface ClientBuild {
  id: string;
  project_id: string;
  lane: string;
  builder: string;
  substrate: string | null;
  builder_ref: string | null;
  iteration: number;
  status: string;
  spec_prompt: string | null;
  preview_url: string | null;
  live_app_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface ClientFeedback {
  id: string;
  body: string;
  source: string;
  severity: string | null;
  created_at: string;
}

export interface ActiveBuilder {
  id: string;
  label: string;
  supports_iteration: boolean;
}

export interface BuildDiffShape {
  files?: { path: string; change: string }[];
  summary?: string;
}
