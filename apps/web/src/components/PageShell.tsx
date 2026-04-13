import {
  Avatar,
  Button,
  Dropdown,
  FixedZIndex,
  IconButton,
  SheetMobile,
  Tooltip
} from "gestalt";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { PropsWithChildren } from "react";

import type { SessionResponse } from "@flathunter/shared";

type PageShellProps = PropsWithChildren<{
  user: NonNullable<SessionResponse["user"]>;
  sourceIssueCount: number;
  onLogout: () => void;
}>;

const navigationItems = [
  {
    href: "/overview",
    label: "Overview",
    icon: "home"
  },
  {
    href: "/listings",
    label: "Listings",
    icon: "search"
  },
  {
    href: "/sources",
    label: "Sources",
    icon: "data-source"
  },
  {
    href: "/settings",
    label: "Settings",
    icon: "cog"
  }
] as const;

const userMenuZIndex = new FixedZIndex(1200);

type ShellViewport = "desktop" | "compact" | "mobile";

function getShellViewport(): ShellViewport {
  if (typeof window === "undefined") {
    return "desktop";
  }

  if (window.innerWidth < 1024) {
    return "mobile";
  }

  if (window.innerWidth < 1360) {
    return "compact";
  }

  return "desktop";
}

type NavigationProps = {
  pathname: string;
  sourceIssueCount: number;
  onNavigate: (href: string) => void;
  user: NonNullable<SessionResponse["user"]>;
  onLogout: () => void;
};

function CompactRail({ pathname, sourceIssueCount, onNavigate, user, onLogout }: NavigationProps) {
  const userMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const displayName = user.name || user.login;

  return (
    <div className="compact-rail">
      <div className="compact-rail__brand">FH</div>
      <div className="compact-rail__divider" />
      <div className="compact-rail__nav">
        {navigationItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const badgeText =
            item.href === "/sources" && sourceIssueCount > 0
              ? String(sourceIssueCount)
              : null;

          return (
            <Tooltip key={item.href} inline text={item.label}>
              <div className="compact-rail__item">
                <IconButton
                  accessibilityLabel={item.label}
                  bgColor={isActive ? "gray" : "lightGray"}
                  icon={item.icon}
                  iconColor={isActive ? "light" : "darkGray"}
                  onClick={() => onNavigate(item.href)}
                  size="md"
                />
                {badgeText ? <span className="compact-rail__badge">{badgeText}</span> : null}
              </div>
            </Tooltip>
          );
        })}
      </div>

      <div className="compact-rail__divider" />

      <div className="compact-rail__footer">
        <Tooltip inline text={`${displayName} (@${user.login})`}>
          <button
            className="compact-rail__user-trigger"
            onClick={() => setIsUserMenuOpen((current) => !current)}
            ref={userMenuAnchorRef}
            type="button"
          >
            <Avatar accessibilityLabel={displayName} name={displayName} size="md" src={user.avatarUrl ?? undefined} />
          </button>
        </Tooltip>

        {isUserMenuOpen && userMenuAnchorRef.current ? (
          <Dropdown
            anchor={userMenuAnchorRef.current}
            id="compact-user-menu"
            onDismiss={() => setIsUserMenuOpen(false)}
            zIndex={userMenuZIndex}
          >
            <Dropdown.Item
              onSelect={() => {
                setIsUserMenuOpen(false);
                onNavigate("/settings");
              }}
              option={{
                label: "Open settings",
                value: "settings"
              }}
            />
            <Dropdown.Item
              onSelect={() => {
                setIsUserMenuOpen(false);
                void onLogout();
              }}
              option={{
                label: "Sign out",
                value: "signout"
              }}
            />
          </Dropdown>
        ) : null}
      </div>
    </div>
  );
}

function MobileNavigationSheet({
  onDismiss,
  onNavigate,
  pathname,
  sourceIssueCount,
  user,
  onLogout
}: NavigationProps & {
  onDismiss: () => void;
}) {
  return (
    <SheetMobile
      heading="Workspace"
      onDismiss={onDismiss}
      padding="default"
      size="full"
      subHeading="Navigate between overview, review queue, sources and runtime settings."
    >
      <div className="mobile-nav-sheet">
        {navigationItems.map((item) => {
          const isActive = pathname.startsWith(item.href);
          const counter =
            item.href === "/sources" && sourceIssueCount > 0
              ? String(sourceIssueCount)
              : null;

          return (
            <Button
              key={item.href}
              color={isActive ? "dark" : "gray"}
              fullWidth
              iconStart={item.icon}
              size="lg"
              text={counter ? `${item.label} (${counter})` : item.label}
              onClick={() => {
                onDismiss();
                onNavigate(item.href);
              }}
            />
          );
        })}

        <div className="mobile-nav-sheet__footer">
          <Button color="gray" fullWidth iconStart="cog" size="lg" text="Open settings" onClick={() => onNavigate("/settings")} />
          <Button color="red" fullWidth size="lg" text={`Sign out @${user.login}`} onClick={() => void onLogout()} />
        </div>
      </div>
    </SheetMobile>
  );
}

export function PageShell({ user, sourceIssueCount, onLogout, children }: PageShellProps) {
  const location = useLocation();
  const navigate = useNavigate();

  const [viewport, setViewport] = useState<ShellViewport>(getShellViewport);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const isMobile = viewport === "mobile";

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      const nextViewport = getShellViewport();
      setViewport(nextViewport);

      if (nextViewport !== "mobile") {
        setIsMobileNavOpen(false);
      }
    };

    handleResize();
    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  const handleNavigate = (href: string) => {
    setIsMobileNavOpen(false);

    if (location.pathname === href) {
      return;
    }

    navigate(href);
  };

  return (
    <div className={`app-frame app-frame--${viewport}`}>
      {viewport !== "mobile" ? (
        <aside className="app-rail app-rail--compact">
          <CompactRail
            onNavigate={handleNavigate}
            onLogout={onLogout}
            pathname={location.pathname}
            sourceIssueCount={sourceIssueCount}
            user={user}
          />
        </aside>
      ) : null}

      {isMobile && isMobileNavOpen ? (
        <MobileNavigationSheet
          onDismiss={() => setIsMobileNavOpen(false)}
          onNavigate={handleNavigate}
          onLogout={onLogout}
          pathname={location.pathname}
          sourceIssueCount={sourceIssueCount}
          user={user}
        />
      ) : null}

      <div className={`app-main${isMobile ? "" : " app-main--shell-only"}`}>
        {isMobile ? (
          <header className="app-topbar app-topbar--mobile">
            <IconButton
              accessibilityLabel="Open workspace navigation"
              bgColor="lightGray"
              icon="menu"
              iconColor="darkGray"
              onClick={() => setIsMobileNavOpen(true)}
              size="md"
            />
          </header>
        ) : null}
        <main className="app-content">{children}</main>
      </div>
    </div>
  );
}
