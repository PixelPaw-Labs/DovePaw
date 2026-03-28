import * as React from "react";

const DataTableContext = React.createContext<{ headerClassName?: string }>({});

export function DataTable({
  cols,
  children,
  className,
  headerClassName,
}: {
  cols: string;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
}) {
  return (
    <DataTableContext.Provider value={{ headerClassName }}>
      <div
        className={`rounded-xl border border-outline-variant/30 bg-surface-container overflow-hidden grid ${cols}${className ? ` ${className}` : ""}`}
      >
        {children}
      </div>
    </DataTableContext.Provider>
  );
}

export function DataTableHeader({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { headerClassName } = React.useContext(DataTableContext);
  return (
    <div
      className={`col-span-full grid grid-cols-subgrid gap-4 items-center px-5 py-3 border-b border-outline-variant/20 bg-primary/10${headerClassName ? ` ${headerClassName}` : ""}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

export function DataTableRow({
  children,
  isLast,
  className,
}: {
  children: React.ReactNode;
  isLast?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`col-span-full grid grid-cols-subgrid gap-4 items-center px-5 py-4 hover:bg-surface-container-high/50 transition-colors group${isLast ? "" : " border-b border-outline-variant/10"}${className ? ` ${className}` : ""}`}
    >
      {children}
    </div>
  );
}

export function DataTableEmpty({
  icon: Icon,
  title,
  description,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-xl border border-outline-variant/30 bg-surface-container${className ? ` ${className}` : ""}`}
    >
      <div className="flex flex-col items-center justify-center py-16 gap-3 text-on-surface-variant">
        <Icon className="w-10 h-10 opacity-30" />
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs opacity-60">{description}</p>
      </div>
    </div>
  );
}

export const headerCellClass =
  "text-xs font-semibold text-on-surface-variant uppercase tracking-wider";
