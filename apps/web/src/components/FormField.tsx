import type { PropsWithChildren, ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type FormFieldProps = PropsWithChildren<{
  htmlFor?: string;
  label: string;
  description?: ReactNode;
  className?: string;
}>;

export function FormField({ children, className, description, htmlFor, label }: FormFieldProps) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {description ? <p className="text-xs leading-relaxed text-muted-foreground">{description}</p> : null}
    </div>
  );
}
