import type { PropsWithChildren, ReactNode } from "react";

type SectionHeaderProps = PropsWithChildren<{
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}>;

export function SectionHeader({ title, subtitle, actions }: SectionHeaderProps) {
  return (
    <div className="page-section-header">
      <div className="page-section-header__copy">
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="page-section-header__actions">{actions}</div> : null}
    </div>
  );
}
