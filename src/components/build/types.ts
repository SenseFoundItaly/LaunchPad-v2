// Shared client-side shapes for the Build & Launch hub (mirror the API rows).

export interface ClientBuild {
  id: string;
  project_id: string;
  lane: string;
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

// #275 white-label: the API exposes CAPABILITIES only — never the vendor identity.
export interface ActiveBuilder {
  supports_iteration: boolean;
  supports_async?: boolean;
  supports_deploy?: boolean;
}

export interface BuildDiffShape {
  files?: { path: string; change: string }[];
  summary?: string;
}
