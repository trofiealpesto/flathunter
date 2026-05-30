import type { PropsWithChildren, ReactNode } from "react";

import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type SurfaceCardProps = PropsWithChildren<{
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  className?: string;
  contentClassName?: string;
}>;

export function SurfaceCard({ title, subtitle, actions, className, contentClassName, children }: SurfaceCardProps) {
  return (
    <Card className={cn("min-w-0", className)}>
      {title || subtitle || actions ? (
        <CardHeader>
          {title || subtitle ? (
            <div className="grid gap-1">
              {title ? <CardTitle>{title}</CardTitle> : null}
              {subtitle ? <CardDescription>{subtitle}</CardDescription> : null}
            </div>
          ) : null}
          {actions ? <CardAction>{actions}</CardAction> : null}
        </CardHeader>
      ) : null}
      <CardContent className={cn("min-w-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
