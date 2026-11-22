export const ssr = false;
export const prerender = false;

export interface HomepageLoadData {
  bossIntakeEnabled: boolean;
  grokbot1WireEnabled: boolean;
}

function readRuntimeFlag(key: 'PUBLIC_STARLI_BOSS_INTAKE_ENABLED' | 'PUBLIC_STARLI_GROKBOT1_WIRE_ENABLED'): boolean {
  if (typeof window !== 'undefined') {
    const cfg = (window as unknown as Record<string, Record<string, unknown> | undefined>).__STARLI_RUNTIME_CONFIG__;
    if (cfg && typeof cfg[key] === 'boolean') return cfg[key] as boolean;
    if (cfg && typeof cfg[key] === 'string') return cfg[key] === '1' || cfg[key] === 'true';
  }
  const envObj = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const val = envObj[key] ?? envObj[`VITE_${key}`];
  return val === '1' || val === 'true';
}

export function load(): HomepageLoadData {
  return {
    bossIntakeEnabled: readRuntimeFlag('PUBLIC_STARLI_BOSS_INTAKE_ENABLED'),
    grokbot1WireEnabled: readRuntimeFlag('PUBLIC_STARLI_GROKBOT1_WIRE_ENABLED'),
  };
}
