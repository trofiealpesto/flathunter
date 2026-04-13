import { Box, Flex, Heading, Text } from "gestalt";

export function LoginGate() {
  return (
    <div className="login-screen">
      <Box color="default" rounding={6} padding={8}>
        <Flex direction="column" gap={4}>
          <Text size="100" color="subtle">
            Private dashboard
          </Text>
          <Heading size="600" accessibilityLevel={1}>
            Review listings, scoring, and semantic matches in one place
          </Heading>
          <Text>
            Authentication is restricted to the configured GitHub admin account. Start the OAuth flow to access the
            dashboard.
          </Text>
          <div>
            <a href="/api/auth/github/start" className="primary-link">
              Sign in with GitHub
            </a>
          </div>
        </Flex>
      </Box>
    </div>
  );
}
