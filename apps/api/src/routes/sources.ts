import {
  deletePortalSourceAuth,
  getDecryptedPortalSessionState,
  getPortalSource,
  getPortalSourceAuthSummary,
  putPortalCredentials,
  updatePortalSource
} from "@flathunter/db";
import { isActiveSourcePortal, portalSchema, portalSourceAuthUpsertSchema, portalSourcePatchSchema, type Portal } from "@flathunter/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { AppDeps } from "../app";
import { requireSession } from "../lib/session";
import { ensureDefaultPortalSources, listActivePortalSources, persistPortalAuthResult, refreshPortalAuthState } from "../lib/sources";
import type { SourceSessionState } from "../lib/source-auth";

const paramsSchema = z.object({
  portal: portalSchema
});

function resolveActivePortal(input: unknown): Portal | null {
  const { portal } = paramsSchema.parse(input);
  return isActiveSourcePortal(portal) ? portal : null;
}

async function resolveAuthManagedSource(deps: AppDeps, portal: Portal) {
  const source = await getPortalSource(deps.db, portal);

  if (!source || !source.capabilities.supportsLogin) {
    return null;
  }

  return source;
}

export function registerSourceRoutes(app: FastifyInstance, deps: AppDeps) {
  app.get("/api/sources", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    return listActivePortalSources(deps.db);
  });

  app.patch("/api/sources/:portal", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    const existingSource = await getPortalSource(deps.db, portal);

    if (!existingSource) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    const patch = portalSourcePatchSchema.parse(request.body);

    if (patch.enabled === true && existingSource.capabilities.requiresAuthSetup) {
      const authSummary = await getPortalSourceAuthSummary(deps.db, portal);

      if (authSummary.authStatus !== "session_valid") {
        reply.code(409).send({
          message: "This source requires a valid authenticated session. Save credentials and refresh the session before enabling it."
        });
        return;
      }
    }

    const updatedSource = await updatePortalSource(deps.db, portal, patch);

    if (!updatedSource) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    return updatedSource;
  });

  app.get("/api/sources/:portal/auth", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    if (!(await resolveAuthManagedSource(deps, portal))) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    return getPortalSourceAuthSummary(deps.db, portal);
  });

  app.put("/api/sources/:portal/auth", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    if (!(await resolveAuthManagedSource(deps, portal))) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    const payload = portalSourceAuthUpsertSchema.parse(request.body);

    return putPortalCredentials(deps.db, portal, payload, deps.env.PORTAL_SECRETS_KEY);
  });

  app.post("/api/sources/:portal/auth/refresh", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    if (!(await resolveAuthManagedSource(deps, portal))) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    return refreshPortalAuthState(deps.db, portal, deps.env, deps.sourceAuthRunner);
  });

  app.delete("/api/sources/:portal/auth", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    if (!(await resolveAuthManagedSource(deps, portal))) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    const summary = await deletePortalSourceAuth(deps.db, portal);

    if (portal !== "IMMOWELT") {
      await updatePortalSource(deps.db, portal, {
        enabled: false
      });
    }

    return summary;
  });

  app.get("/api/sources/:portal/auth/bootstrap", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    if (!(await resolveAuthManagedSource(deps, portal))) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    return deps.sourceAuthBootstrap.getStatus(portal, deps.env);
  });

  app.post("/api/sources/:portal/auth/bootstrap/start", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }
    const source = await resolveAuthManagedSource(deps, portal);

    if (!source) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    const storedSession = await getDecryptedPortalSessionState<SourceSessionState>(deps.db, portal, deps.env.PORTAL_SECRETS_KEY);

    return deps.sourceAuthBootstrap.start({
      portal,
      searchUrl: source.searchUrl,
      sessionState: storedSession?.storageState ?? null,
      env: deps.env
    });
  });

  app.post("/api/sources/:portal/auth/bootstrap/finish", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }
    const source = await resolveAuthManagedSource(deps, portal);

    if (!source) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    const result = await deps.sourceAuthBootstrap.finish({
      portal,
      searchUrl: source.searchUrl,
      env: deps.env
    });

    if (result.authResult) {
      await persistPortalAuthResult(deps.db, portal, deps.env, result.authResult);
    }

    return {
      bootstrap: result.bootstrap,
      authSummary: await getPortalSourceAuthSummary(deps.db, portal)
    };
  });

  app.delete("/api/sources/:portal/auth/bootstrap", async (request, reply) => {
    if (!requireSession(request, reply, deps.env)) {
      return;
    }

    await ensureDefaultPortalSources(deps.db);
    const portal = resolveActivePortal(request.params);

    if (!portal) {
      reply.code(404).send({
        message: "Source not found"
      });
      return;
    }

    if (!(await resolveAuthManagedSource(deps, portal))) {
      reply.code(404).send({
        message: "Source auth not found"
      });
      return;
    }

    return deps.sourceAuthBootstrap.cancel(portal);
  });
}
