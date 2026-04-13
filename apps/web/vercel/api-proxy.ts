function buildProxyHeaders(request: Request, apiOrigin: URL) {
  const headers = new Headers(request.headers);
  const incomingUrl = new URL(request.url);

  headers.set("host", apiOrigin.host);
  headers.set("x-forwarded-host", incomingUrl.host);
  headers.set("x-forwarded-proto", incomingUrl.protocol.replace(":", ""));
  headers.set("x-forwarded-for", headers.get("x-forwarded-for") ?? "0.0.0.0");
  headers.delete("connection");
  headers.delete("content-length");

  return headers;
}

function buildProxyTarget(request: Request, apiOrigin: string) {
  const incomingUrl = new URL(request.url);
  return new URL(`${incomingUrl.pathname}${incomingUrl.search}`, apiOrigin);
}

export const runtime = "nodejs";

export default async function proxyApiRequest(request: Request) {
  const apiOrigin = process.env.API_ORIGIN;

  if (!apiOrigin) {
    return new Response("API_ORIGIN is not configured", {
      status: 500
    });
  }

  const originUrl = new URL(apiOrigin);
  const response = await fetch(buildProxyTarget(request, apiOrigin), {
    method: request.method,
    headers: buildProxyHeaders(request, originUrl),
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
    redirect: "manual"
  });

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });
}
