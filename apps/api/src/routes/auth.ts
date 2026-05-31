import { z } from "zod";

import { sessionResponseSchema } from "@flathunter/shared";
import type { FastifyInstance } from "fastify";

import type { AppDeps } from "../app";
import { buildGitHubAuthorizeUrl, exchangeGitHubCode, fetchGitHubUser } from "../github/client";
import {
  buildCanonicalOauthStartUrl,
  clearSession,
  consumeOauthState,
  issueOauthState,
  issueSession,
  normalizeGitHubLogin,
  readSession,
  shouldRedirectOauthStartToAppOrigin
} from "../lib/session";

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1)
});

export function registerAuthRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/api/auth/github/start", async (request, reply) => {
    if (shouldRedirectOauthStartToAppOrigin(request, deps.env)) {
      reply.redirect(buildCanonicalOauthStartUrl(deps.env));
      return;
    }

    const state = issueOauthState(reply, deps.env);
    reply.redirect(buildGitHubAuthorizeUrl(deps.env, state));
  });

  app.get("/api/auth/github/callback", async (request, reply) => {
    const query = callbackQuerySchema.parse(request.query);
    const isValidState = consumeOauthState(request, reply, deps.env, query.state);

    if (!isValidState) {
      const loginUrl = new URL("/", deps.env.APP_ORIGIN);
      loginUrl.searchParams.set("auth_error", "oauth_state");
      reply.redirect(loginUrl.toString());
      return;
    }

    const accessToken = await exchangeGitHubCode(deps.env, query.code, deps.fetchImpl);
    const user = await fetchGitHubUser(accessToken, deps.fetchImpl);

    if (normalizeGitHubLogin(user.login) !== normalizeGitHubLogin(deps.env.ADMIN_GITHUB_LOGIN)) {
      clearSession(reply);
      reply.code(403).send({
        message: "GitHub account is not allowed"
      });
      return;
    }

    issueSession(reply, deps.env, {
      login: normalizeGitHubLogin(user.login),
      name: user.name,
      avatarUrl: user.avatar_url
    });

    reply.redirect(`${deps.env.APP_ORIGIN}/`);
  });

  app.get("/api/auth/session", async (request) => {
    const session = readSession(request, deps.env);
    return sessionResponseSchema.parse({
      authenticated: Boolean(session),
      user: session
        ? {
            login: session.login,
            name: session.name,
            avatarUrl: session.avatarUrl
          }
        : null
    });
  });

  app.post("/api/auth/logout", async (_request, reply) => {
    clearSession(reply);
    reply.code(204).send();
  });
}
