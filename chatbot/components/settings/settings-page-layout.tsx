import { Breadcrumb } from "@/components/ui/breadcrumb";

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface SettingsPageLayoutProps {
  title: string;
  /** Breadcrumb items rendered in the sticky header (after the hardcoded ← Home). */
  breadcrumbItems?: BreadcrumbItem[];
  children: React.ReactNode;
}

export function SettingsPageLayout({ title, breadcrumbItems, children }: SettingsPageLayoutProps) {
  return (
    <>
      <header className="sticky top-0 z-50 bg-background/80 backdrop-blur-xl border-b border-border/20 flex items-center gap-2 w-full px-8 py-4 shrink-0">
        <Breadcrumb items={breadcrumbItems ?? []} />
        <span className="text-muted-foreground/40 text-sm">/</span>
        <h1 className="text-xl font-bold text-foreground tracking-tight">{title}</h1>
      </header>

      <div className="flex-1 px-8 py-8 max-w-7xl mx-auto w-full">{children}</div>
    </>
  );
}
