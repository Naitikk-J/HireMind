/// <reference types="vite/client" />

// pdf.js worker is loaded via Vite's `?url` query suffix at runtime.
declare module "pdfjs-dist/build/pdf.worker.mjs?url" {
  const src: string;
  export default src;
}
