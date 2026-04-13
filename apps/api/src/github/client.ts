import type { ApiEnv } from "../config";

type GitHubAccessTokenResponse = {
  access_token?: string;
  error?: string;
  error_description?: string;
};

export type GitHubUser = {
  login: string;
  name: string | null;
  avatar_url: string | null;
};

export function buildGitHubAuthorizeUrl(env: ApiEnv, state: string) {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", env.GITHUB_CLIENT_ID);
  url.searchParams.set("redirect_uri", `${env.APP_ORIGIN}/api/auth/github/callback`);
  url.searchParams.set("scope", "read:user");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeGitHubCode(env: ApiEnv, code: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: `${env.APP_ORIGIN}/api/auth/github/callback`
    })
  });

  if (!response.ok) {
    throw new Error(`GitHub token exchange failed with status ${response.status}`);
  }

  const payload = (await response.json()) as GitHubAccessTokenResponse;

  if (!payload.access_token) {
    throw new Error(payload.error_description ?? payload.error ?? "GitHub did not return an access token");
  }

  return payload.access_token;
}

export async function fetchGitHubUser(accessToken: string, fetchImpl: typeof fetch) {
  const response = await fetchImpl("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "User-Agent": "flathunter"
    }
  });

  if (!response.ok) {
    throw new Error(`GitHub user fetch failed with status ${response.status}`);
  }

  return (await response.json()) as GitHubUser;
}

