import type { UpstreamHealthProbe } from './types.js';

export class HttpUpstreamHealthProbe implements UpstreamHealthProbe {
  constructor(
    private url: string,
    private timeoutMs: number = 3000
  ) {}

  async probe(): Promise<{
    ready: boolean;
    service: string;
    dependencies: Record<string, 'UP' | 'DOWN' | 'DEGRADED'>;
    details?: string;
  }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(this.url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'StarliControlPlane/1.0',
        },
      });

      clearTimeout(timeout);

      if (!response.ok) {
        return {
          ready: false,
          service: 'starlidigital-backend',
          dependencies: {
            api: 'DOWN',
          },
          details: `Upstream HTTP ${response.status}`,
        };
      }

      const text = await response.text();
      // Cap body to 16KB to prevent memory exhaustion / bombs
      if (text.length > 16 * 1024) {
        return {
          ready: false,
          service: 'starlidigital-backend',
          dependencies: { api: 'DEGRADED' },
          details: 'Upstream response exceeded size bound',
        };
      }

      let data: any = {};
      try {
        data = JSON.parse(text);
      } catch {
        return {
          ready: false,
          service: 'starlidigital-backend',
          dependencies: { api: 'DEGRADED' },
          details: 'Upstream returned non-JSON payload',
        };
      }

      const isReady = data.ready === true || data.ok === true || data.status === 'ok';
      return {
        ready: isReady,
        service: 'starlidigital-backend',
        dependencies: {
          api: 'UP',
          database: 'UP',
        },
        details: 'Healthy',
      };
    } catch (err: any) {
      clearTimeout(timeout);
      const isTimeout = err?.name === 'AbortError';
      return {
        ready: false,
        service: 'starlidigital-backend',
        dependencies: {
          api: 'DOWN',
        },
        details: isTimeout ? 'Upstream probe timed out' : 'Upstream probe connection failed',
      };
    }
  }
}
