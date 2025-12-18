"use client";

import { Toaster as SonnerToaster, toast as sonnerToast, ExternalToast } from "sonner";

export const AppToaster = () => <SonnerToaster richColors position="bottom-right" />;

export const toast = Object.assign(
  (message: string, opts?: ExternalToast) => sonnerToast(message, { duration: 3500, ...opts }),
  {
    success: (message: string, opts?: ExternalToast) => sonnerToast.success(message, { duration: 3500, ...opts }),
    error: (message: string, opts?: ExternalToast) => sonnerToast.error(message, { duration: 3500, ...opts }),
  }
);
