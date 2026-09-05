import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useTranslation } from "react-i18next";
import { useRefreshInteractionLocked } from "../shell/refresh-lock.tsx";

export function AttemptDialog({ title, children, onClose }: {
  readonly title: string;
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation();
  const interactionLocked = useRefreshInteractionLocked();
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="niceeval-view-dialog-overlay" inert={interactionLocked ? true : undefined} />
        <Dialog.Content
          className="niceeval-view-dialog"
          inert={interactionLocked ? true : undefined}
          onEscapeKeyDown={(event) => { if (interactionLocked) event.preventDefault(); }}
          onPointerDownOutside={(event) => { if (interactionLocked) event.preventDefault(); }}
        >
          <div className="niceeval-view-dialog-head">
            <Dialog.Title className="niceeval-view-dialog-title">{title}</Dialog.Title>
            <Dialog.Close disabled={interactionLocked} className="niceeval-view-dialog-close" aria-label={t("report.close")}>×</Dialog.Close>
          </div>
          <div className="niceeval-view-dialog-body niceeval-view-report-slot">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
