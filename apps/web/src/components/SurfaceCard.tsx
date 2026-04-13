import { Box, Flex, Heading, Text } from "gestalt";
import type { PropsWithChildren, ReactNode } from "react";

type SurfaceCardProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
}>;

export function SurfaceCard({ title, subtitle, actions, className, children }: SurfaceCardProps) {
  return (
    <div className={`surface-card${className ? ` ${className}` : ""}`}>
      <Box color="default" rounding={6} padding={5}>
        {title || subtitle || actions ? (
          <Flex alignItems="start" justifyContent="between" gap={4} wrap>
            {title || subtitle ? (
              <div className="panel-header">
                {title ? (
                  <Heading size="300" accessibilityLevel={2}>
                    {title}
                  </Heading>
                ) : null}
                {subtitle ? (
                  <Text size="100" color="subtle">
                    {subtitle}
                  </Text>
                ) : null}
              </div>
            ) : null}
            {actions ? <div className="panel-header-actions">{actions}</div> : null}
          </Flex>
        ) : null}
        {children}
      </Box>
    </div>
  );
}
