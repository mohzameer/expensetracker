"use client";

import type { ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerTitle } from "@/components/ui/drawer";
import { useMediaQuery } from "@/hooks/use-media-query";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
};

/** Bottom sheet on phones, centred dialog on wider screens. */
export function Sheet({ open, onOpenChange, title, description, headerRight, children }: Props) {
  const wide = useMediaQuery("(min-width: 768px)");

  const header = (Title: typeof DialogTitle | typeof DrawerTitle, Desc: typeof DialogDescription | typeof DrawerDescription) => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <Title className="m-0 font-display text-2xl font-semibold text-ink">{title}</Title>
        {headerRight}
      </div>
      {description ? (
        <Desc asChild>
          <div className="text-sm">{description}</div>
        </Desc>
      ) : (
        <Desc className="sr-only">{typeof title === "string" ? title : "Sheet"}</Desc>
      )}
    </div>
  );

  if (wide) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          showCloseButton={false}
          className="flex max-h-[92dvh] flex-col gap-[18px] overflow-y-auto rounded-3xl bg-surface p-6 sm:max-w-[460px]"
        >
          {header(DialogTitle, DialogDescription)}
          {children}
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange} repositionInputs={false}>
      <DrawerContent className="max-h-[94dvh] rounded-t-3xl border-0 bg-surface data-[vaul-drawer-direction=bottom]:max-h-[94dvh]">
        <div className="flex flex-col gap-[18px] overflow-y-auto px-4 pt-4 pb-[max(28px,env(safe-area-inset-bottom))]">
          {header(DrawerTitle, DrawerDescription)}
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
