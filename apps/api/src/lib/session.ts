import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { sessionSchema, type Session } from "@flathunter/shared";

import type { ApiEnv } from "../config";

const SESSION_COOKIE = "fh_session";
const STATE_COOKIE = "fh_github_state";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const STATE_TTL_MS = 1000 * 60 * 10;

function encode(input: string) {
  return Buffer.from(input).toString("base64url");
}

function decode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

function sign(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function isSignatureValid(payload: string, signature: string, secret: string) {
  const expected = sign(payload, secret);
  if (signature.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function buildSessionCookieValue(session: Session, secret: string) {
  const encodedPayload = encode(JSON.stringify(session));
  const signature = sign(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export function parseSessionCookieValue(value: string | undefined, secret: string): Session | null {
  if (!value) {
    return null;
  }

  const [encodedPayload, signature] = value.split(".");

  if (!encodedPayload || !signature || !isSignatureValid(encodedPayload, signature, secret)) {
    return null;
  }

  try {
    const parsed = sessionSchema.parse(JSON.parse(decode(encodedPayload)));
    if (new Date(parsed.expiresAt).getTime() < Date.now()) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function issueSession(reply: FastifyReply, env: ApiEnv, payload: Omit<Session, "expiresAt">) {
  const session = {
    ...payload,
    expiresAt: new Date(Date.now() + SESSION_TTL_MS).toISOString()
  } satisfies Session;

  reply.setCookie(SESSION_COOKIE, buildSessionCookieValue(session, env.SESSION_SECRET), {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: env.APP_ORIGIN.startsWith("https"),
    maxAge: Math.floor(SESSION_TTL_MS / 1000)
  });
}

export function clearSession(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    path: "/",
    sameSite: "lax"
  });
}

export function readSession(request: FastifyRequest, env: ApiEnv): Session | null {
  return parseSessionCookieValue(request.cookies[SESSION_COOKIE], env.SESSION_SECRET);
}

export function createOauthState(secret: string) {
  const state = randomBytes(24).toString("base64url");
  return `${state}.${sign(state, secret)}`;
}

export function issueOauthState(reply: FastifyReply, env: ApiEnv) {
  const state = createOauthState(env.SESSION_SECRET);
  reply.setCookie(STATE_COOKIE, state, {
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: env.APP_ORIGIN.startsWith("https"),
    maxAge: Math.floor(STATE_TTL_MS / 1000)
  });
  return state.split(".")[0];
}

export function consumeOauthState(request: FastifyRequest, reply: FastifyReply, env: ApiEnv, state: string) {
  const cookie = request.cookies[STATE_COOKIE];
  reply.clearCookie(STATE_COOKIE, {
    httpOnly: true,
    path: "/",
    sameSite: "lax"
  });

  if (!cookie) {
    return false;
  }

  const [rawState, signature] = cookie.split(".");
  if (!rawState || !signature) {
    return false;
  }

  return rawState === state && isSignatureValid(rawState, signature, env.SESSION_SECRET);
}

export function requireSession(request: FastifyRequest, reply: FastifyReply, env: ApiEnv): Session | null {
  const session = readSession(request, env);

  if (!session) {
    reply.code(401).send({
      message: "Unauthorized"
    });
    return null;
  }

  return session;
}

export function normalizeGitHubLogin(login: string) {
  return login.trim().toLowerCase();
}
