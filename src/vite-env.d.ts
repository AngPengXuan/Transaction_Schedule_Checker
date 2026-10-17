/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Google Analytics 4 Measurement ID, e.g. G-ABC123XYZ. Empty: GA is not loaded. */
  readonly VITE_GA_ID?: string;
  /** GoatCounter site code, the "name" in name.goatcounter.com. Empty: not loaded. */
  readonly VITE_GOATCOUNTER_CODE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
