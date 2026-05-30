import type { ComponentProps } from "react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Tone = "success" | "warning" | "danger" | "info" | "neutral" | "brand";

const toneClasses: Record<Tone, string> = {
  brand: "bg-primary text-primary-foreground",
  danger: "bg-destructive/10 text-destructive",
  info: "bg-sky-500/10 text-sky-700 dark:text-sky-300",
  neutral: "bg-muted text-muted-foreground",
  success: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  warning: "bg-amber-500/10 text-amber-700 dark:text-amber-300"
};

export function ToneBadge({
  tone = "neutral",
  className,
  ...props
}: ComponentProps<typeof Badge> & {
  tone?: Tone;
}) {
  return <Badge className={cn(toneClasses[tone], className)} variant="secondary" {...props} />;
}

export function toneFromState(value: string | null | undefined): Tone {
  if (!value) {
    return "neutral";
  }

  if (["MATCH", "CONTACTED", "session_valid", "success", "Healthy", "Ready", "Live capture"].includes(value)) {
    return "success";
  }

  if (["REJECT", "REJECTED", "BLACKLISTED", "failed", "auth_failed", "error", "Failed"].includes(value)) {
    return "danger";
  }

  if (["UNSURE", "NEW", "REVIEWED", "partial", "challenge_required", "session_expired", "warning"].includes(value)) {
    return "warning";
  }

  return "info";
}
