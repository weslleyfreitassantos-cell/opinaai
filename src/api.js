const nativeRuntime = () => Boolean(globalThis.Capacitor?.Plugins?.OpinaRuntime);

export function isNativeRuntime() {
  return nativeRuntime();
}

export function apiBaseUrl() {
  const configured = globalThis.__OPINA_API_BASE_URL__ || import.meta.env.VITE_OPINA_API_BASE_URL;
  // Native production builds must never fall back to the tablet itself. The
  // local URL only works when an API server is running inside the device.
  const base = configured || (nativeRuntime() ? 'https://opinaai.grupotec.dev.br' : '');
  return String(base).replace(/\/$/, '');
}

export function apiUrl(path) {
  return `${apiBaseUrl()}${path}`;
}
