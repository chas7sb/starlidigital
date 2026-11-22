import React from 'react';
import { useParams, useSearchParams } from 'react-router';
import { HostedAgentChat } from './HostedAgentChat';
import './hosted-agents.css';

export function HostedAgentEmbed() {
  const params = useParams<{ publicId?: string }>();
  const [searchParams] = useSearchParams();
  const publicId = params.publicId || searchParams.get('publicId') || searchParams.get('agent') || '';

  if (!publicId) {
    return (
      <div className="ha-embed-window" style={{ alignItems: 'center', justifyContent: 'center', padding: '24px', textAlign: 'center' }}>
        <p style={{ color: 'var(--ha-muted)', fontSize: '13px' }}>
          Invalid embed configuration: missing agent identifier.
        </p>
      </div>
    );
  }

  return (
    <div className="ha-embed-window">
      <HostedAgentChat publicId={publicId} embedded={true} />
    </div>
  );
}
