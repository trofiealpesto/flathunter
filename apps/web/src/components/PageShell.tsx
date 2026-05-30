import {
  Database,
  Home,
  LogOut,
  Search,
  Settings,
  UserRound
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import type { ComponentType, PropsWithChildren } from "react";

import type { SessionResponse } from "@flathunter/shared";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger
} from "@/components/ui/sidebar";

type PageShellProps = PropsWithChildren<{
  user: NonNullable<SessionResponse["user"]>;
  sourceIssueCount: number;
  onLogout: () => void;
}>;

const navigationItems: Array<{
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
}> = [
  { href: "/overview", label: "Overview", icon: Home },
  { href: "/listings", label: "Listings", icon: Search },
  { href: "/sources", label: "Sources", icon: Database },
  { href: "/settings", label: "Settings", icon: Settings }
];

function initials(value: string) {
  return value
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function PageShell({ user, sourceIssueCount, onLogout, children }: PageShellProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const displayName = user.name || user.login;

  return (
    <SidebarProvider defaultOpen>
      <Sidebar collapsible="icon">
        <SidebarHeader>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton className="font-semibold" size="lg">
                <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">FH</span>
                <span className="truncate">FlatHunter</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Workspace</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {navigationItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = location.pathname.startsWith(item.href);

                  return (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={isActive}
                        onClick={() => {
                          if (location.pathname !== item.href) {
                            navigate(item.href);
                          }
                        }}
                        tooltip={item.label}
                      >
                        <Icon />
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                      {item.href === "/sources" && sourceIssueCount > 0 ? (
                        <SidebarMenuBadge>{sourceIssueCount}</SidebarMenuBadge>
                      ) : null}
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <SidebarMenuButton size="lg">
                    <Avatar className="size-8 rounded-lg">
                      <AvatarImage alt={displayName} src={user.avatarUrl ?? undefined} />
                      <AvatarFallback className="rounded-lg">{initials(displayName)}</AvatarFallback>
                    </Avatar>
                    <span className="grid flex-1 text-left text-sm leading-tight">
                      <span className="truncate font-medium">{displayName}</span>
                      <span className="truncate text-xs text-muted-foreground">@{user.login}</span>
                    </span>
                  </SidebarMenuButton>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56" side="right">
                  <DropdownMenuLabel>@{user.login}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => navigate("/settings")}>
                    <UserRound />
                    Open settings
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void onLogout()}>
                    <LogOut />
                    Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-h-svh overflow-hidden bg-background">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger />
          <Badge className="md:hidden" variant="outline">
            FlatHunter
          </Badge>
        </header>
        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4 md:p-5">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
