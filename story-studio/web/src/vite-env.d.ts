/// <reference types="vite/client" />

type PrismDesktopInfo = {
  productName: string;
  version: string;
  dataRoot: string;
  logs: string;
  packaged: boolean;
  components: Array<{
    id: "prism-h3" | "ffmpeg" | "real-esrgan" | "ace-step";
    label: string;
    category: "required" | "builtin-small" | "optional-large";
    status: "ready" | "installed" | "incomplete" | "missing";
    path: string;
    message: string;
    capabilities: string[];
  }>;
};

interface Window {
  prismDesktop?: {
    getInfo: () => Promise<PrismDesktopInfo>;
    chooseProjectLibrary: () => Promise<{ canceled: boolean; dataRoot?: string; restartRequired?: boolean }>;
    openProjectLibrary: () => Promise<{ ok: boolean; error?: string }>;
    chooseH3Installation: () => Promise<{ canceled: boolean; executable?: string; restartRequired?: boolean; components?: PrismDesktopInfo["components"] }>;
    chooseAceStepInstallation: () => Promise<{ canceled: boolean; executable?: string; projectRoot?: string; restartRequired?: boolean }>;
  };
}
