/**
 * Next.js instrumentation hook. `register()` runs once per server instance before
 * requests are served; we use it to enforce APP_MODE rules at startup (Node only).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertModeAtStartup } = await import('./src/config/env');
    assertModeAtStartup();
  }
}
