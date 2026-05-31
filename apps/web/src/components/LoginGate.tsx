import { GitBranch } from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";
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

function getAuthErrorMessage() {
  if (typeof window === "undefined") {
    return null;
  }

  const authError = new URLSearchParams(window.location.search).get("auth_error");

  if (authError === "oauth_state") {
    return "The GitHub sign-in expired or started from another address. Start sign-in again from this page.";
  }

  return null;
}

export function LoginGate() {
  const signInHref = getGitHubSignInHref();
  const authErrorMessage = getAuthErrorMessage();

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
          {authErrorMessage ? (
            <Alert variant="destructive">
              <AlertDescription>{authErrorMessage}</AlertDescription>
            </Alert>
          ) : null}
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
