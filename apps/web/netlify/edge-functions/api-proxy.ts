declare const Netlify: {
  env: {
    get(name: string): string | undefined;
  };
};

export default async (request: Request) => {
  const apiOrigin = Netlify.env.get("API_ORIGIN");

  if (!apiOrigin) {
    return new Response("API_ORIGIN is not configured", {
      status: 500
    });
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(incomingUrl.pathname + incomingUrl.search, apiOrigin);

  return fetch(upstreamUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
  });
};

export const config = {
  path: "/api/*"
};
