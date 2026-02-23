// In dev mode, Vite proxies /api to localhost:8080 (see vite.config.ts).
// In production, set VITE_API_URL to the backend URL.
const API_BASE = import.meta.env.VITE_API_URL || '';

export interface Item {
  id: string;
  url: string;
  title: string;
  domain: string;
  source_type: string;
  intent_text: string;
  status: string;
  priority?: string;
  match_score?: number;
  error_info?: string;
  save_count: number;
  created_at: string;
  updated_at: string;
}

export interface Artifact {
  id: string;
  item_id: string;
  artifact_type: string;
  payload: string;
  created_by: string;
  created_at: string;
}

export interface Intent {
  id: string;
  item_id: string;
  text: string;
  created_at: string;
}

export interface ItemWithArtifacts extends Item {
  artifacts: Artifact[];
  intents: Intent[];
}

export interface SynthesisPayload {
  points: string[];
  insight: string;
}

export interface ScorePayload {
  intent_score: number;
  quality_score: number;
  final_score: number;
  priority: string;
}

export interface TodoItem {
  title: string;
  eta: string;
  type: string;
  done?: boolean;
}

export interface TodosPayload {
  todos: TodoItem[];
}

export interface ContentMeta {
  author?: string;
  publish_date?: string;
  word_count: number;
  image_url?: string;
  language?: string;
}

export interface ExtractionPayload {
  normalized_text: string;
  content_meta: ContentMeta;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const resp = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${resp.status}`);
  }
  return resp.json();
}

export const api = {
  listItems: (status?: string, query?: string) => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (query) params.set('q', query);
    const qs = params.toString();
    return request<Item[]>(`/api/items${qs ? `?${qs}` : ''}`);
  },

  getItem: (id: string) =>
    request<ItemWithArtifacts>(`/api/items/${id}`),

  deleteItem: (id: string) =>
    request<{ id: string; deleted: string }>(`/api/items/${id}`, { method: 'DELETE' }),

  retry: (id: string) =>
    request<{ id: string; status: string }>(`/api/items/${id}/retry`, { method: 'POST' }),

  reprocess: (id: string) =>
    request<{ id: string; status: string }>(`/api/items/${id}/reprocess`, { method: 'POST' }),

  updateStatus: (id: string, status: string) =>
    request<{ id: string; status: string }>(`/api/items/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  editArtifact: (itemId: string, type: string, payload: unknown) =>
    request<Artifact>(`/api/items/${itemId}/artifacts/${type}`, {
      method: 'PUT',
      body: JSON.stringify({ payload }),
    }),

  batchUpdateStatus: (ids: string[], status: string) =>
    request<{ updated: number }>('/api/items/batch/status', {
      method: 'POST',
      body: JSON.stringify({ ids, status }),
    }),

  batchDelete: (ids: string[]) =>
    request<{ deleted: number }>('/api/items/batch/delete', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
};

export function parseArtifact<T>(artifacts: Artifact[], type: string): T | null {
  const artifact = artifacts.find(a => a.artifact_type === type);
  if (!artifact) return null;
  try {
    return JSON.parse(artifact.payload) as T;
  } catch {
    return null;
  }
}

export function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
