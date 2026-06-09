import type {
  AppSettings,
  AppSettingsPatch,
  ContactAttempt,
  ContactAttemptCreate,
  ContactMessage,
  DashboardStats,
  GeoSearchResult,
  ListingDetail,
  ListingFilters,
  ListingSummary,
  Portal,
  PortalSourceAuthBootstrapFinishResult,
  PortalSourceAuthBootstrapSummary,
  PortalSourceAuthSummary,
  PortalSourceAuthUpsert,
  PortalSourcePatch,
  PortalSourceSummary,
  SessionResponse,
  UserStatus
} from "@flathunter/shared";

export type StatsSummary = {
  totals: {
    listings: number;
    match: number;
    unsure: number;
    reject: number;
  };
  byPortal: Record<string, number>;
  byStatus: Record<string, number>;
};

export type ResetListingsResult = {
  deletedListings: number;
  resetSources: number;
};

async function apiFetch<T>(input: RequestInfo, init?: RequestInit): Promise<T> {
  const hasBody = init?.body != null;
  const headers = new Headers(init?.headers ?? {});

  if (hasBody && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(input, {
    credentials: "include",
    headers,
    ...init
  });

  if (!response.ok) {
    const payload = await response.text();
    let message = payload;

    try {
      const parsed = JSON.parse(payload) as { message?: unknown };
      if (typeof parsed.message === "string" && parsed.message.trim().length > 0) {
        message = parsed.message;
      }
    } catch {
      // Keep the raw text when the response body is not JSON.
    }

    throw new Error(message || `Request failed with status ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

function toQueryString(filters: ListingFilters) {
  const params = new URLSearchParams();

  Object.entries(filters).forEach(([key, value]) => {
    if (value != null && value !== "") {
      params.set(key, String(value));
    }
  });

  const query = params.toString();
  return query ? `?${query}` : "";
}

export const api = {
  session: () => apiFetch<SessionResponse>("/api/auth/session"),
  logout: () => apiFetch<void>("/api/auth/logout", { method: "POST" }),
  listListings: (filters: ListingFilters) => apiFetch<ListingSummary[]>(`/api/listings${toQueryString(filters)}`),
  getListing: (id: number) => apiFetch<ListingDetail>(`/api/listings/${id}`),
  generateListingLlmAnalysis: (id: number) =>
    apiFetch<ListingDetail>(`/api/listings/${id}/llm-analysis`, {
      method: "POST"
    }),
  generateContactMessage: (id: number) =>
    apiFetch<ContactMessage>(`/api/listings/${id}/contact-message`, {
      method: "POST"
    }),
  createContactAttempt: (id: number, payload: ContactAttemptCreate) =>
    apiFetch<ContactAttempt>(`/api/listings/${id}/contact-attempts`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  listContactAttempts: (id: number) => apiFetch<ContactAttempt[]>(`/api/listings/${id}/contact-attempts`),
  clearListingDuplicate: (id: number) =>
    apiFetch<ListingDetail>(`/api/listings/${id}/duplicate`, {
      method: "DELETE"
    }),
  updateListingStatus: (id: number, userStatus: UserStatus) =>
    apiFetch<ListingDetail>(`/api/listings/${id}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        userStatus
      })
    }),
  getStats: () => apiFetch<StatsSummary>("/api/stats/summary"),
  getDashboardStats: () => apiFetch<DashboardStats>("/api/stats/dashboard"),
  getSettings: () => apiFetch<AppSettings>("/api/settings"),
  listSources: () => apiFetch<PortalSourceSummary[]>("/api/sources"),
  getSourceAuthSummary: (portal: Portal) => apiFetch<PortalSourceAuthSummary>(`/api/sources/${portal}/auth`),
  getSourceAuthBootstrap: (portal: Portal) =>
    apiFetch<PortalSourceAuthBootstrapSummary>(`/api/sources/${portal}/auth/bootstrap`),
  putSourceAuth: (portal: Portal, payload: PortalSourceAuthUpsert) =>
    apiFetch<PortalSourceAuthSummary>(`/api/sources/${portal}/auth`, {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  refreshSourceAuth: (portal: Portal) =>
    apiFetch<PortalSourceAuthSummary>(`/api/sources/${portal}/auth/refresh`, {
      method: "POST"
    }),
  deleteSourceAuth: (portal: Portal) =>
    apiFetch<PortalSourceAuthSummary>(`/api/sources/${portal}/auth`, {
      method: "DELETE"
    }),
  startSourceAuthBootstrap: (portal: Portal) =>
    apiFetch<PortalSourceAuthBootstrapSummary>(`/api/sources/${portal}/auth/bootstrap/start`, {
      method: "POST"
    }),
  finishSourceAuthBootstrap: (portal: Portal) =>
    apiFetch<PortalSourceAuthBootstrapFinishResult>(`/api/sources/${portal}/auth/bootstrap/finish`, {
      method: "POST"
    }),
  cancelSourceAuthBootstrap: (portal: Portal) =>
    apiFetch<PortalSourceAuthBootstrapSummary>(`/api/sources/${portal}/auth/bootstrap`, {
      method: "DELETE"
    }),
  searchOfficeLocation: (query: string) =>
    apiFetch<GeoSearchResult[]>("/api/geo/search", {
      method: "POST",
      body: JSON.stringify({
        query
      })
    }),
  updateSource: (portal: Portal, patch: PortalSourcePatch) =>
    apiFetch<PortalSourceSummary>(`/api/sources/${portal}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  patchSettings: (patch: AppSettingsPatch) =>
    apiFetch<AppSettings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch)
    }),
  resetListings: () =>
    apiFetch<ResetListingsResult>("/api/settings/reset-listings", {
      method: "POST"
    })
};
