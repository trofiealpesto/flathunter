import { GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function getGitHubSignInHref() {
  if (typeof window === "undefined") {
    return "/api/auth/github/start";
  }

  if (window.location.hostname === "127.0.0.1") {
    return `${window.location.protocol}//localhost:${window.location.port}/api/auth/github/start`;
  }

  return "/api/auth/github/start";
}

export function LoginGate() {
  const signInHref = getGitHubSignInHref();

  return (
    <main className="grid min-h-svh place-items-center bg-background p-6 text-foreground">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardDescription>Private dashboard</CardDescription>
          <CardTitle className="text-2xl">Review listings, scoring, and semantic matches in one place</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Authentication is restricted to the configured GitHub admin account. Start the OAuth flow to access the dashboard.
          </p>
          <Button asChild className="w-full" size="lg">
            <a href={signInHref}>
              <GitBranch />
              Sign in with GitHub
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
