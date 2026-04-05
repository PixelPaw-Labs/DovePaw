"use client";

import * as React from "react";
import { Search } from "lucide-react";
import {
  ICON_NAMES,
  LUCIDE_ICON_REGISTRY,
  ICON_COLOR_PRESETS,
  DEFAULT_ICON_STYLE,
} from "@@/lib/icon-registry";
import { Input } from "@/components/ui/input";

interface IconPickerProps {
  iconName: string | undefined;
  iconBg: string | undefined;
  iconColor: string | undefined;
  onChange: (iconName: string, iconBg: string, iconColor: string) => void;
}

export function IconPicker({ iconName, iconBg, iconColor, onChange }: IconPickerProps) {
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase();
    return q ? ICON_NAMES.filter((n) => n.toLowerCase().includes(q)) : ICON_NAMES;
  }, [search]);

  const resolvedName = iconName ?? "Bot";
  const resolvedBg = iconBg ?? DEFAULT_ICON_STYLE.iconBg;
  const resolvedColor = iconColor ?? DEFAULT_ICON_STYLE.iconColor;

  const activePresetIndex = ICON_COLOR_PRESETS.findIndex((p) => p.iconBg === resolvedBg);
  const activePreset = ICON_COLOR_PRESETS[activePresetIndex] ?? ICON_COLOR_PRESETS[0];

  const SelectedIcon = LUCIDE_ICON_REGISTRY[resolvedName] ?? LUCIDE_ICON_REGISTRY["Bot"];

  function selectIcon(name: string) {
    onChange(name, resolvedBg, resolvedColor);
  }

  function selectPreset(preset: (typeof ICON_COLOR_PRESETS)[number]) {
    onChange(resolvedName, preset.iconBg, preset.iconColor);
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Preview + color swatches */}
      <div className="flex items-center gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: activePreset.previewBg, color: activePreset.previewIconColor }}
        >
          <SelectedIcon className="w-4 h-4" />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {ICON_COLOR_PRESETS.map((preset, i) => (
            <button
              key={preset.label}
              type="button"
              title={preset.label}
              onClick={() => selectPreset(preset)}
              style={{ backgroundColor: preset.swatch }}
              className={`w-5 h-5 rounded-full border-2 transition-all ${
                i === activePresetIndex
                  ? "border-primary scale-110"
                  : "border-transparent hover:scale-110"
              }`}
            />
          ))}
        </div>
        <span className="text-xs text-muted-foreground ml-1">{resolvedName}</span>
      </div>

      {/* Search input */}
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search icons…"
          className="pl-8 h-8 text-sm"
        />
      </div>

      {/* Icon grid */}
      {filtered.length > 0 ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1 max-h-44 overflow-y-auto rounded-lg border border-border/30 bg-muted/20 p-1.5">
          {filtered.map((name) => {
            const Icon = LUCIDE_ICON_REGISTRY[name];
            const isSelected = name === resolvedName;
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => selectIcon(name)}
                className={`flex flex-col items-center gap-0.5 py-2 px-1 rounded-lg text-[9px] leading-tight transition-all ${
                  isSelected ? "ring-1 ring-primary" : "text-muted-foreground hover:bg-background"
                }`}
                style={
                  isSelected
                    ? {
                        backgroundColor: activePreset.previewBg,
                        color: activePreset.previewIconColor,
                      }
                    : undefined
                }
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate w-full text-center">{name}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center py-3">
          No icons matching &ldquo;{search}&rdquo;
        </p>
      )}
    </div>
  );
}
