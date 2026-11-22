import React, { useState, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Sparkles, ShieldCheck, CalendarDays, Bot, MessageSquare } from 'lucide-react';
import { SUPPORT_WHATSAPP_URL } from '../contact';
import { fetchHostedAgentPublic } from './client';
import type { HostedAgentPublic } from './types';
import { STOMA_SAN_DEMO_AGENT } from './demo-data';
import { HostedAgentChat } from './HostedAgentChat';
import './hosted-agents.css';
import '../shared-public.css';
import './demo.css';

export { STOMA_SAN_DEMO_AGENT };

export function HostedAgentDemo({
  siteHeader,
  siteFooter
}: {
  siteHeader?: React.ReactNode;
  siteFooter?: React.ReactNode;
}) {
  const params = useParams<{ slug?: string }>();
  const [searchParams] = useSearchParams();
  const slug = params.slug || searchParams.get('slug') || '';
  const publicId = searchParams.get('agent') || searchParams.get('publicId') || '';
  const [agent, setAgent] = useState<HostedAgentPublic | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setError(null);

    // Default to Stoma San demo if no slug or explicitly stoma-san
    if (!slug && !publicId) {
      setAgent(STOMA_SAN_DEMO_AGENT);
      setLoading(false);
      return;
    }

    if (slug === 'stoma-san' || slug === 'demo') {
      setAgent(STOMA_SAN_DEMO_AGENT);
      setLoading(false);
      return;
    }

    setLoading(true);
    fetchHostedAgentPublic({ slug: slug || undefined, publicId: publicId || undefined })
      .then(result => {
        if (!active) return;
        if (result) {
          setAgent(result);
        } else {
          // If slug is not found in database, provide fallback to the Stoma San showcase demo
          setAgent(STOMA_SAN_DEMO_AGENT);
        }
      })
      .catch(() => {
        if (!active) return;
        // On network/API glitch or preview deployment, show the Stoma San showcase
        setAgent(STOMA_SAN_DEMO_AGENT);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [slug, publicId]);

  return (
    <div className="marketing home-v2 agent-demo-world">
      {siteHeader}

      <div className="agent-demo-space-wrap" aria-hidden="true">
        <img
          className="agent-demo-backdrop"
          src="/brand/home-hero.webp"
          srcSet="/brand/home-hero-mobile.webp 900w, /brand/home-hero.webp 1672w"
          sizes="100vw"
          alt=""
        />
        <div className="agent-demo-hero-shade" />
        <div className="agent-demo-orb agent-demo-orb-1" />
        <div className="agent-demo-orb agent-demo-orb-2" />
      </div>

      <main className="agent-demo-main">
        <div className="agent-demo-intro">
          <div className="home-eyebrow">
            <span />
            <span>AI AGENT LIVE DEMO · STARLIDIGITAL PLATFORM</span>
          </div>
          <h1>
            Meet your next<br className="agent-demo-break" /> <span>customer connection.</span>
          </h1>
          <p className="agent-demo-lead">
            Experience a specialized AI receptionist in real time. Ask questions, explore treatments,
            and see how intelligent conversations create trust and capture patient bookings.
          </p>
        </div>

        <div className="agent-demo-stage">
          {loading && (
            <div className="agent-demo-status" role="status">
              <Sparkles size={32} className="spin" />
              <h2>Preparing AI Assistant…</h2>
              <p>Connecting to business knowledge and session runtime…</p>
            </div>
          )}
          {error && !agent && (
            <div className="agent-demo-status" role="alert">
              <Sparkles size={32} />
              <h2>This demo is unavailable</h2>
              <p>{error}</p>
              <button
                type="button"
                className="home-secondary"
                onClick={() => setAgent(STOMA_SAN_DEMO_AGENT)}
              >
                Launch Stoma San Showcase <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          {agent && (
            <HostedAgentChat
              key={agent.publicId}
              publicId={agent.publicId}
              preloadedAgent={agent}
              presentation="glass"
            />
          )}
        </div>

        <div className="agent-demo-under">
          <div className="agent-demo-trust">
            <ShieldCheck size={17} />
            <span>Interactive live demo · Real-time reasoning powered by custom business knowledge &amp; Starli runtime</span>
          </div>
          <div className="agent-demo-actions">
            <Link
              to="/app/chat?prompt=I+want+an+AI+receptionist+like+Stoma+San+for+my+business"
              className="pill-button light"
            >
              <Sparkles size={16} />
              <span>Deploy for your business</span>
              <ArrowUpRight size={15} />
            </Link>
            <a
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="pill-button outline"
            >
              <MessageSquare size={16} />
              <span>Discuss on WhatsApp</span>
            </a>
          </div>
        </div>

        <section className="agent-demo-benefits">
          <div className="agent-demo-benefit">
            <div className="agent-demo-benefit-icon">
              <CalendarDays size={24} />
            </div>
            <h3>Automated Appointments</h3>
            <p>
              Guides patients through consultations, available schedules, and clinic requirements
              without waiting on hold or navigating complex forms.
            </p>
          </div>
          <div className="agent-demo-benefit">
            <div className="agent-demo-benefit-icon">
              <Sparkles size={24} />
            </div>
            <h3>Trained on Clinic Knowledge</h3>
            <p>
              Answers specific questions about dental treatments, post-op care, doctor specialties,
              and transparent pricing with total accuracy.
            </p>
          </div>
          <div className="agent-demo-benefit">
            <div className="agent-demo-benefit-icon">
              <Bot size={24} />
            </div>
            <h3>Omnichannel Delivery</h3>
            <p>
              Embeds on your website as a floating assistant or standalone booking portal, syncing
              patient leads directly with your CRM and team mailbox.
            </p>
          </div>
        </section>

        <section className="agent-demo-cta-card">
          <div className="agent-demo-cta-copy">
            <div className="home-kicker">INTELLIGENT BUSINESS AUTOMATION</div>
            <h2>Ready for an AI assistant that works 24/7?</h2>
            <p>
              We configure your agent, train it on your services and prices, and integrate it into
              your digital presence within 48 hours.
            </p>
          </div>
          <div className="agent-demo-cta-btns">
            <Link
              to="/app/chat?prompt=I+want+an+AI+agent+for+my+business"
              className="pill-button light"
            >
              Start building with Starli <ArrowUpRight size={16} />
            </Link>
            <a
              href={SUPPORT_WHATSAPP_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="pill-button outline"
            >
              Talk on WhatsApp
            </a>
          </div>
        </section>
      </main>

      {siteFooter}
    </div>
  );
}
