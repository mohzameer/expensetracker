"use client";

import { useRef, useState, type ReactNode } from "react";
import { Command } from "cmdk";
import { ChevronDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboOption = { value: string; label: string; color?: string; hint?: ReactNode };

type Props = {
  id: string;
  options: ComboOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  onCreate?: (text: string) => void;
  /** Adds a first option that clears the value, e.g. "No category". */
  emptyOption?: { label: string; hint?: ReactNode };
  placeholder?: string;
  disabled?: boolean;
  badge?: ReactNode;
  invalid?: boolean;
};

/** Type to filter; no match offers `+ Create "…"`. The list renders inline so it works inside sheets. */
export function CreatableCombobox({ id, options, value, onChange, onCreate, emptyOption, placeholder, disabled, badge }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const selected = options.find((o) => o.value === value) ?? null;
  const q = query.trim();
  const exact = options.some((o) => o.label.toLowerCase() === q.toLowerCase());
  // Our own filter so matches keep a stable order (prefix matches first) and
  // "Create" always sits last.
  const needle = q.toLowerCase();
  const shown = needle
    ? options
        .filter((o) => o.label.toLowerCase().includes(needle))
        .sort((a, b) => Number(!a.label.toLowerCase().startsWith(needle)) - Number(!b.label.toLowerCase().startsWith(needle)))
    : options;

  const choose = (v: string | null) => {
    onChange(v);
    setOpen(false);
    setQuery("");
    inputRef.current?.blur();
  };

  return (
    <Command shouldFilter={false} loop className="flex flex-col gap-1.5 overflow-visible bg-transparent">
      <div
        className={cn(
          "flex min-h-[52px] items-center gap-2.5 rounded-[14px] border bg-surface px-3.5 transition-colors",
          open ? "border-[1.5px] border-teal" : "border-line-strong",
          disabled && "opacity-50",
        )}
      >
        {selected?.color && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: selected.color }} />}
        <Command.Input
          ref={inputRef}
          id={id}
          disabled={disabled}
          value={open ? query : (selected?.label ?? "")}
          onValueChange={setQuery}
          onFocus={() => {
            setOpen(true);
            setQuery("");
          }}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              inputRef.current?.blur();
            }
          }}
          placeholder={open ? (selected?.label ?? placeholder) : placeholder}
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
          autoComplete="off"
        />
        {badge}
        <ChevronDown aria-hidden className="size-[18px] shrink-0 text-muted-ink" />
      </div>
      {open && (
        <Command.List
          onMouseDown={(e) => e.preventDefault()}
          className="max-h-60 overflow-y-auto rounded-[14px] border border-line bg-surface p-1 shadow-[0_8px_24px_rgba(27,26,23,0.08)]"
        >
          {emptyOption && !q && (
            <Command.Item
              value="__none__"
              onSelect={() => choose(null)}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] px-3 text-[15px] text-muted-ink data-[selected=true]:bg-paper"
            >
              <span className="flex-1">{emptyOption.label}</span>
              {emptyOption.hint}
            </Command.Item>
          )}
          {shown.map((o) => (
            <Command.Item
              key={o.value}
              value={o.value}
              onSelect={() => choose(o.value)}
              className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] px-3 text-[15px] data-[selected=true]:bg-paper"
            >
              {o.color && <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: o.color }} />}
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="text-[13px] text-muted-ink">{o.hint}</span>}
            </Command.Item>
          ))}
          {onCreate && q && !exact && (
            <Command.Item
              value={`__create__ ${q}`}
              onSelect={() => {
                setOpen(false);
                setQuery("");
                inputRef.current?.blur();
                onCreate(q);
              }}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-3 text-[15px] font-semibold text-teal data-[selected=true]:bg-teal-wash"
            >
              <Plus aria-hidden className="size-4" />
              Create “{q}”
            </Command.Item>
          )}
          {!onCreate && shown.length === 0 && (
            <div className="px-3 py-3 text-sm text-muted-ink">No matches</div>
          )}
        </Command.List>
      )}
    </Command>
  );
}
