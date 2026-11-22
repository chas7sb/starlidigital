import React, { useEffect, useState } from 'react';
import './proposal.css';
import { useParams } from 'react-router';
import { publicGql } from '../hosted-agents/client';

export interface HostedAgentProposalData {
  id: string;
  kind: 'HOSTED_AGENT';
  publicSlug: string;
  agentPublicId: string;
  businessName: string;
  industry?: string | null;
  status: string;
  title: string;
  summary: string;
  features: string[];
  recommendedAgentType: string;
  quoteMonthlyEur?: number | null;
  quoteSetupEur?: number | null;
  quoteTerms?: string | null;
  demoUrl: string;
}

export interface HostedAgentProposalProps {
  slug?: string;
  proposal?: HostedAgentProposalData;
  fetchProposal?: (slug: string) => Promise<HostedAgentProposalData | null>;
  onContactSales?: () => void;
}

export const HostedAgentProposal: React.FC<HostedAgentProposalProps> = ({
  slug,
  proposal: initialProposal,
  fetchProposal,
  onContactSales
}) => {
  const params = useParams<{ slug?: string }>();
  const effectiveSlug = slug || params.slug;
  const [data, setData] = useState<HostedAgentProposalData | null>(initialProposal || null);
  const [loading, setLoading] = useState<boolean>(!initialProposal);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (initialProposal) {
      setData(initialProposal);
      return;
    }
    if (!effectiveSlug) { setLoading(false); setError('Missing proposal identifier.'); return; }

    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        if (fetchProposal) {
          const res = await fetchProposal(effectiveSlug);
          if (active) setData(res);
        } else {
          const result = await publicGql<{ hostedAgentProposalPublic: HostedAgentProposalData | null }>(
            `query AgentProposal($slug: String!) { hostedAgentProposalPublic(slug: $slug) {
              id kind publicSlug agentPublicId businessName industry status title summary features
              recommendedAgentType quoteMonthlyEur quoteSetupEur quoteTerms demoUrl
            } }`, { slug: effectiveSlug });
          if (active) setData(result.hostedAgentProposalPublic);
        }
      } catch (err: any) {
        if (active) setError(err.message || 'Unable to load this proposal.');
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [effectiveSlug, initialProposal, fetchProposal]);

  if (loading) {
    return (
      <div className="agent-proposal-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ color: '#c084fc', fontSize: '16px' }}>Loading your AI solution…</div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="agent-proposal-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="agent-proposal-card" style={{ maxWidth: '500px', textAlign: 'center' }}>
          <h2 style={{ color: '#ef4444', margin: 0 }}>Proposal unavailable</h2>
          <p style={{ color: '#94a3b8' }}>
            {error || 'This proposal is unavailable or has been archived.'}
          </p>
          <a href="/" style={{ color: '#c084fc', textDecoration: 'underline' }}>Back to homepage</a>
        </div>
      </div>
    );
  }

  return (
    <div className="agent-proposal-container">
      <div className="agent-proposal-wrapper">
        <header className="agent-proposal-header">
          <div className="agent-proposal-badge">
            STARLIDIGITAL • YOUR DEDICATED AI ASSISTANT
          </div>
          <h1 className="agent-proposal-title">{data.title}</h1>
          <p className="agent-proposal-summary">{data.summary}</p>
        </header>

        <div className="agent-proposal-grid">
          {/* Left Column: Solution Scope & Quote */}
          <div className="agent-proposal-card">
            <div>
              <h3 style={{ margin: '0 0 8px 0', fontSize: '18px', color: '#fff' }}>
                Configured capabilities
              </h3>
              <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                Configured for <strong>{data.businessName}</strong> ({data.recommendedAgentType})
              </p>
            </div>

            <ul className="agent-proposal-features">
              {data.features.map((feat, idx) => (
                <li key={idx} className="agent-proposal-feature-item">
                  <span className="agent-proposal-feature-check">✓</span>
                  <span>{feat}</span>
                </li>
              ))}
            </ul>

            <div className="agent-proposal-pricing">
              <div style={{ fontSize: '12px', textTransform: 'uppercase', color: '#c084fc', fontWeight: 600, letterSpacing: '0.5px' }}>
                Your proposed plan
              </div>
              <div style={{ margin: '8px 0' }}>
                <span className="agent-proposal-price-val">
                  {data.quoteMonthlyEur != null ? `€${data.quoteMonthlyEur}` : 'Custom pricing'}
                </span>
                {data.quoteMonthlyEur != null && <span className="agent-proposal-price-period"> / month</span>}
              </div>
              {data.quoteSetupEur != null && (
                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                  Setup & knowledge configuration: {data.quoteSetupEur === 0 ? 'Included (€0)' : `€${data.quoteSetupEur}`}
                </div>
              )}
              {data.quoteTerms && (
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '6px' }}>
                  {data.quoteTerms}
                </div>
              )}
            </div>

            <button
              onClick={() => {
                if (onContactSales) onContactSales();
                else window.location.href = `mailto:contact@starlidigital.ro?subject=Activate AI assistant — ${encodeURIComponent(data.businessName)}`;
              }}
              style={{
                padding: '12px 20px',
                background: 'linear-gradient(135deg, #9333ea, #7c3aed)',
                border: 'none',
                borderRadius: '8px',
                color: '#fff',
                fontWeight: 600,
                fontSize: '15px',
                cursor: 'pointer',
                marginTop: '10px'
              }}
            >
              Activate your AI assistant
            </button>
          </div>

          {/* Right Column: Live Interactive Demo Chat */}
          <div className="agent-proposal-interactive-pane">
            <div className="agent-proposal-demo-bar">
              <div>
                <span className="agent-proposal-live-dot"></span>
                <strong>Live interactive demo</strong> — Try your assistant
              </div>
              <span style={{ fontSize: '11px', color: '#64748b' }}>Powered by Starli</span>
            </div>
            <iframe
              title={`Demo AI ${data.businessName}`}
              src={data.demoUrl}
              className="agent-proposal-iframe"
              allow="clipboard-write"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
