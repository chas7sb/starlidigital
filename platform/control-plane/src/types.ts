export interface AuthPrincipal {
  id: string;
  role: 'admin' | 'operator' | 'customer';
  scopes: string[];
  clientId?: string;
  email?: string;
}

export interface TokenVerificationResult {
  valid: boolean;
  principal?: AuthPrincipal;
  error?: string;
}

export interface TokenVerifier {
  verify(token: string): Promise<TokenVerificationResult>;
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  principalId: string;
  clientIp?: string;
  tool: string;
  target?: string;
  durationMs: number;
  status: 'SUCCESS' | 'DENIED' | 'FAILED';
  sanitizedArgs?: Record<string, unknown>;
  sanitizedResult?: Record<string, unknown>;
  error?: string;
}

export interface AuditSink {
  record(entry: AuditEntry): Promise<void> | void;
  list(limit?: number): Promise<AuditEntry[]> | AuditEntry[];
}

export interface UpstreamHealthProbe {
  probe(): Promise<{
    ready: boolean;
    service: string;
    dependencies: Record<string, 'UP' | 'DOWN' | 'DEGRADED'>;
    details?: string;
  }>;
}

export interface ControlPlaneConfig {
  port: number;
  host: string;
  upstreamHealthUrl: string;
  controlDbPath: string;
  allowedOrigins: string[];
  oauthIssuer?: string;
  oauthAudience?: string;
  /** Canonical externally reachable MCP URL; never derive from an untrusted Host header. */
  publicResourceUrl?: string;
}
