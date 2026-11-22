import {RotateCcw, Maximize2, Minimize2, Info, Send, CalendarDays, BriefcaseBusiness, Euro, Bot, LoaderCircle} from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import type { HostedAgentPublic, HostedAgentAppearance, HostedAgentMessage } from './types';
import {
  fetchHostedAgentPublic,
  startHostedAgentConversation,
  sendHostedAgentMessage
} from './client';
import './hosted-agents.css';

export function ToothIcon({ size = 20, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M7 3C4.5 3 2.5 5.5 2.5 8.5C2.5 11.5 3.5 13.5 4.5 16C5.5 18.5 6 21 8 21C9.8 21 10.2 18.5 12 18.5C13.8 18.5 14.2 21 16 21C18 21 18.5 18.5 19.5 16C20.5 13.5 21.5 11.5 21.5 8.5C21.5 5.5 19.5 3 17 3C15 3 13.5 4.5 12 4.5C10.5 4.5 9 3 7 3Z" />
    </svg>
  );
}

function StarliStar({ size = 22, className = '' }: { size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      <path d="M32 0C34.5 25.5 38.5 29.5 64 32C38.5 34.5 34.5 38.5 32 64C29.5 38.5 25.5 34.5 0 32C25.5 29.5 29.5 25.5 32 0Z" />
    </svg>
  );
}

function getStomaSanReply(text: string): string {
  const norm = text.toLowerCase();
  if (norm.includes('program') || norm.includes('programez') || norm.includes('orar') || norm.includes('disponibil')) {
    return 'Vă pot ajuta cu drag cu o programare la Clinica Stoma San!\n\nAveți o zi sau un interval orar preferat (de exemplu, dimineața între 09:00 - 13:00 sau după-amiaza între 14:00 - 20:00)? De asemenea, menționați dacă este vorba despre o consultație de rutină, igienizare sau o problemă specifică.';
  }
  if (norm.includes('servici') || norm.includes('tratament') || norm.includes('procedur') || norm.includes('implant') || norm.includes('albire')) {
    return 'La Stoma San oferim o gamă completă de tratamente dentare moderne:\n\n• Profilaxie & igienizare completă (detartraj ultrasunete, periaj profesional, airflow)\n• Terapie restauratoare (plombe estetice compozit)\n• Protetică & Estetică (coroane zirconiu/ceramică, fațete dentare, albire profesională)\n• Implantologie dentară de înaltă precizie\n• Ortodonție (aparate dentare fixe și gutiere invizibile)\n• Chirurgie și endodonție la microscop\n\nDespre care dintre aceste servicii doriți să aflați mai multe?';
  }
  if (norm.includes('preț') || norm.includes('pret') || norm.includes('tarif') || norm.includes('cost') || norm.includes('cat costa')) {
    return 'Iată câteva dintre tarifele orientative practicate la Stoma San:\n\n• Consultație stomatologică inițială + plan de tratament: 150 RON\n• Pachet igienizare completă (detartraj + periaj + airflow): 250 RON\n• Obturație fizionomică (plombă): de la 200 RON\n• Albire dentară profesională în cabinet: 900 RON\n• Coroană ceramică pe suport de zirconiu: de la 1.200 RON\n• Implant dentar premium: de la 2.200 RON\n\nFiecare plan este personalizat după o evaluare clinică detaliată.';
  }
  if (norm.includes('informa') || norm.includes('despre') || norm.includes('contact') || norm.includes('unde') || norm.includes('locat')) {
    return 'Clinica Stoma San oferă servicii stomatologice integrate cu accent pe confortul pacientului și tratamente fără durere.\n\n📍 Adresă: Str. Clinicilor nr. 14, București\n⏰ Program: Luni – Vineri: 09:00 – 20:00 | Sâmbătă: 09:00 – 14:00\n📞 Recepție: +40 722 000 000\n\nCu ce vă mai pot fi de folos astăzi?';
  }
  return 'Vă mulțumesc pentru întrebare! La Stoma San ne asigurăm că fiecare pacient beneficiază de o experiență plăcută și tratamente sigure, fără durere. Doriți să stabilim o programare pentru o consultație sau aveți o întrebare specifică despre tratamentele noastre?';
}

// Deduplicate overlapping mounts (including React StrictMode) without retaining tokens globally.
const sessionStarts = new Map<string, ReturnType<typeof startHostedAgentConversation>>();
function startSession(publicId: string) {
  let promise = sessionStarts.get(publicId);
  if (!promise) {
    promise = startHostedAgentConversation(publicId);
    sessionStarts.set(publicId, promise);
    void promise.finally(() => { if (sessionStarts.get(publicId) === promise) sessionStarts.delete(publicId); }).catch(() => {});
  }
  return promise;
}

export interface HostedAgentChatProps {
  publicId?: string;
  slug?: string;
  embedded?: boolean;
  preloadedAgent?: HostedAgentPublic | null;
  onLeadCaptured?: () => void;
  className?: string;
  presentation?: 'default' | 'glass';
}

export function HostedAgentChat({
  publicId: initialPublicId,
  slug,
  embedded = false,
  preloadedAgent,
  onLeadCaptured,
  className = '',
  presentation = 'default'
}: HostedAgentChatProps) {
  const [agent, setAgent] = useState<HostedAgentPublic | null>(preloadedAgent || null);
  const [loadingAgent, setLoadingAgent] = useState<boolean>(!preloadedAgent);
  const [agentError, setAgentError] = useState<string | null>(null);

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [visitorToken, setVisitorToken] = useState<string | null>(null);
  const [messages, setMessages] = useState<HostedAgentMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [leadNotice, setLeadNotice] = useState(false);
  const [sessionRevision, setSessionRevision] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  const glass = presentation === 'glass';
  const romanian = /[ăâîșțĂÂÎȘȚ]|\b(buna|programari|servicii)\b/i.test(agent?.welcomeMessage || '');
  const clinical = /dent|stoma|clinic|medical/i.test((agent?.businessName || '') + ' ' + (agent?.name || ''));
  const resetConversation = () => {
    if (sendLock.current) return;
    try { sessionStorage.removeItem(`ha_session_${effectivePublicId}`); } catch {}
    setInputText(''); setSessionRevision(value => value + 1);
  };

  const generation = useRef(0);
  const sendLock = useRef(false);
  const pendingTurn = useRef<{ requestId: string; message: string; optimisticId: string } | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement>(null);

  // Parse appearance JSON safely
  const appearance: HostedAgentAppearance = React.useMemo(() => {
    if (!agent?.appearanceJson) return {};
    try {
      return JSON.parse(agent.appearanceJson);
    } catch {
      return {};
    }
  }, [agent?.appearanceJson]);

  // Load public agent details if not preloaded
  useEffect(() => {
    setAgentError(null);
    setAgent(null);
    if (preloadedAgent) {
      setAgent(preloadedAgent);
      setLoadingAgent(false);
      return;
    }

    let isMounted = true;
    setLoadingAgent(true);
    setAgentError(null);

    fetchHostedAgentPublic({ slug, publicId: initialPublicId })
      .then((res) => {
        if (!isMounted) return;
        if (!res) {
          setAgentError('This AI agent is currently unavailable or inactive.');
        } else {
          setAgent(res);
        }
      })
      .catch((err) => {
        if (!isMounted) return;
        setAgentError(err.message || 'Unable to connect to the agent.');
      })
      .finally(() => {
        if (isMounted) setLoadingAgent(false);
      });

    return () => {
      isMounted = false;
    };
  }, [slug, initialPublicId, preloadedAgent]);

  // Establish session with sessionStorage persistence for visitor token
  const effectivePublicId = agent?.publicId;

  useEffect(() => {
    const currentGeneration = ++generation.current;
    setConversationId(null); setVisitorToken(null); setMessages([]); setSendError(null); setLeadNotice(false);
    setSending(false); sendLock.current = false; pendingTurn.current = null;
    if (!effectivePublicId || !agent || !['DEMO', 'ACTIVE'].includes(agent.status)) return;
    let active = true;

    const storageKey = `ha_session_${effectivePublicId}`;
    let cachedSessionRaw: string | null = null;
    try { cachedSessionRaw = sessionStorage.getItem(storageKey); } catch { /* Storage may be blocked in embeds. */ }

    if (cachedSessionRaw) {
      try {
        const cached = JSON.parse(cachedSessionRaw);
        if (cached.conversationId && cached.visitorToken) {
          setConversationId(cached.conversationId);
          setVisitorToken(cached.visitorToken);
          if (cached.welcomeMessage) {
            setMessages([
              {
                id: 'welcome',
                conversationId: cached.conversationId,
                role: 'assistant',
                content: cached.welcomeMessage,
                createdAt: new Date().toISOString()
              }
            ]);
          }
          return;
        }
      } catch {
        try { sessionStorage.removeItem(storageKey); } catch {}
      }
    }

    // Start a fresh conversation
    startSession(effectivePublicId)
      .then((session) => {
        if (!active || generation.current !== currentGeneration) return;
        setConversationId(session.conversationId);
        setVisitorToken(session.visitorToken);

        const initialMsgs: HostedAgentMessage[] = [];
        if (session.welcomeMessage || agent?.welcomeMessage) {
          initialMsgs.push({
            id: 'welcome',
            conversationId: session.conversationId,
            role: 'assistant',
            content: session.welcomeMessage || agent?.welcomeMessage || 'Hello! How can I assist you today?',
            createdAt: new Date().toISOString()
          });
        }
        setMessages(initialMsgs);

        // Cache session token securely in sessionStorage (never in URL or analytics)
        try { sessionStorage.setItem(
          storageKey,
          JSON.stringify({
            conversationId: session.conversationId,
            visitorToken: session.visitorToken,
            welcomeMessage: session.welcomeMessage
          })
        ); } catch { /* Session remains usable without storage. */ }
      })
      .catch((err) => {
        if (active && generation.current === currentGeneration) {
          if (agent?.status === 'DEMO' || effectivePublicId.startsWith('demo-')) {
            const mockConvId = `demo_conv_${effectivePublicId}`;
            const mockToken = `demo_tok_${effectivePublicId}`;
            setConversationId(mockConvId);
            setVisitorToken(mockToken);
            setMessages([
              {
                id: 'welcome',
                conversationId: mockConvId,
                role: 'assistant',
                content: agent?.welcomeMessage || 'Bună! Sunt recepționerul AI pentru Stoma San.\nTe pot ajuta cu informații despre servicii, programări, prețuri sau pregătirea pentru un tratament.\n\nCu ce te pot ajuta astăzi?',
                createdAt: new Date().toISOString()
              }
            ]);
          } else {
            setSendError(err.message || 'Failed to start a conversation session.');
          }
        }
      });
    return () => { active = false; };
  }, [effectivePublicId, agent?.status, agent?.welcomeMessage, sessionRevision]);

  // Scroll to bottom on new messages
  useEffect(() => {
    const viewport = messagesViewportRef.current;
    viewport?.scrollTo({ top: viewport.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  const handleSendMessage = async (e?: React.FormEvent, customText?: string) => {
    if (e) e.preventDefault();
    const textToSend = (customText !== undefined ? customText : inputText).trim();

    if (!textToSend || !effectivePublicId || !conversationId || !visitorToken || sendLock.current) {
      return;
    }

    if (agent?.status === 'DISABLED') {
      setSendError('This agent has been disabled and cannot process new messages.');
      return;
    }

    const turnGeneration = generation.current;
    const retry = pendingTurn.current;
    if (retry && retry.message !== textToSend) {
      setSendError('Retry the pending message before sending another one.'); return;
    }
    const turn = retry || { requestId: crypto.randomUUID(), message: textToSend, optimisticId: crypto.randomUUID() };
    pendingTurn.current = turn;
    sendLock.current = true;
    const optimisticId = turn.optimisticId;
    const userMsg: HostedAgentMessage = {
      id: optimisticId,
      conversationId,
      role: 'user',
      content: textToSend,
      createdAt: new Date().toISOString()
    };

    setMessages((prev) => prev.some(m => m.id === optimisticId) ? prev : [...prev, userMsg]);
    setInputText('');
    setSending(true);
    setSendError(null);

    const requestId = turn.requestId;

    if (conversationId?.startsWith('demo_conv_') || effectivePublicId.startsWith('demo-')) {
      setTimeout(() => {
        if (generation.current !== turnGeneration) return;
        pendingTurn.current = null;
        sendLock.current = false;
        setSending(false);
        const replyText = getStomaSanReply(textToSend);
        const replyMsg: HostedAgentMessage = {
          id: crypto.randomUUID(),
          conversationId,
          role: 'assistant',
          content: replyText,
          createdAt: new Date().toISOString()
        };
        setMessages((prev) => [...prev, replyMsg]);
      }, 550);
      return;
    }

    try {
      const res = await sendHostedAgentMessage(
        effectivePublicId,
        conversationId,
        visitorToken,
        requestId,
        textToSend
      );

      if (generation.current !== turnGeneration) return;
      pendingTurn.current = null;
      if (res.message) {
        setMessages((prev) => prev.some(m => m.id === res.message.id) ? prev : [...prev, res.message]);
      }

      if (res.capturedLead) {
        setLeadNotice(true);
        if (onLeadCaptured) onLeadCaptured();
      }
    } catch (err: any) {
      if (generation.current === turnGeneration) {
        if (agent?.status === 'DEMO' || effectivePublicId.startsWith('demo-')) {
          pendingTurn.current = null;
          const replyText = getStomaSanReply(textToSend);
          const replyMsg: HostedAgentMessage = {
            id: crypto.randomUUID(),
            conversationId,
            role: 'assistant',
            content: replyText,
            createdAt: new Date().toISOString()
          };
          setMessages((prev) => [...prev, replyMsg]);
        } else {
          setSendError(err.message || 'The agent could not answer at this moment. Please try again.');
        }
      }
    } finally {
      if (generation.current === turnGeneration) { sendLock.current = false; setSending(false); }
    }
  };

  if (loadingAgent) {
    return (
      <div className={`ha-chat-widget ${className}`} style={{ alignItems: 'center', justifyContent: 'center', padding: '40px' }}>
        <div style={{ color: 'var(--ha-muted)', fontSize: '13px' }}>Connecting to AI Agent...</div>
      </div>
    );
  }

  if (agentError || !agent) {
    return (
      <div className={`ha-chat-widget ${className}`} style={{ alignItems: 'center', justifyContent: 'center', padding: '40px', textAlign: 'center' }}>
        <div style={{ fontSize: '24px', marginBottom: '8px' }}>🤖</div>
        <strong style={{ fontSize: '14px', color: 'var(--ha-text)', marginBottom: '6px' }}>Agent Inactive</strong>
        <p style={{ fontSize: '12px', color: 'var(--ha-muted)', maxWidth: '320px', margin: 0 }}>
          {agentError || 'This agent is currently disabled or does not exist.'}
        </p>
      </div>
    );
  }

  const primaryColor = appearance.primaryColor || '#b8a4ff';
  const title = appearance.title || agent.businessName || agent.name;
  const subtitle = appearance.subtitle || agent.name;
  const defaults = romanian
    ? (clinical ? ['Programare', 'Servicii', 'Informații', 'Prețuri'] : ['Servicii', 'Cum funcționează?', 'Prețuri', 'Contact'])
    : (clinical ? ['Appointments', 'Services', 'Information', 'Pricing'] : ['Services', 'How it works', 'Pricing', 'Contact']);
  const quickPrompts = Array.isArray(appearance.quickPrompts) ? appearance.quickPrompts : glass ? defaults : [];
  const promptIcons = [CalendarDays, BriefcaseBusiness, Info, Euro];
  const getPromptIcon = (prompt: string, idx: number) => {
    const p = prompt.toLowerCase();
    if (p.includes('program') || p.includes('appoint') || p.includes('schedul')) return CalendarDays;
    if (p.includes('servici') || p.includes('service')) return clinical ? ToothIcon : BriefcaseBusiness;
    if (p.includes('info') || p.includes('informa')) return Info;
    if (p.includes('preț') || p.includes('pret') || p.includes('pric') || p.includes('tarif')) return Euro;
    return promptIcons[idx % promptIcons.length];
  };

  const quickPromptButtons = messages.length <= 1 && quickPrompts.length > 0 && (
    <div className="ha-quick-prompts">
      {quickPrompts.map((prompt, idx) => {
        const Icon = getPromptIcon(prompt, idx);
        return (
          <button
            key={prompt + idx}
            type="button"
            className="ha-btn ha-btn-sm"
            onClick={() => handleSendMessage(undefined, prompt)}
            disabled={sending || !conversationId || !!pendingTurn.current}
          >
            {glass && <Icon size={16} />} <span>{prompt}</span>
          </button>
        );
      })}
    </div>
  );

  return (
    <div className={`ha-chat-widget ${glass ? 'ha-glass' : ''} ${expanded ? 'ha-glass-expanded' : ''} ${className}`}>
      {/* Header */}
      <div className="ha-chat-header">
        <div className="ha-chat-agent-info">
          <div className="ha-chat-avatar" style={glass ? undefined : { borderColor: `${primaryColor}40`, color: primaryColor }}>
            {glass ? (clinical ? <ToothIcon size={28} /> : <Bot size={27}/>) : agent.name.charAt(0).toUpperCase()}
          </div>
          <div className="ha-chat-header-names">
            <strong>{title}</strong>
            <small>{glass ? (
              <>
                <span className="ha-tag-status">{agent.status === 'DEMO' ? 'Demo' : 'AI Assistant'}</span>
                <span className="ha-sep-dot">•</span>
                <span className="ha-tag-online"><i className="ha-online-light"/> Online</span>
                <span className="ha-sep-dot">•</span>
                <span className="ha-header-credit">{agent.status === 'DEMO' ? 'Unofficial Example by StarliDigital' : 'Powered by StarliDigital'}</span>
              </>
            ) : (
              <>{subtitle} &bull; <span style={{ color: 'var(--ha-green)' }}>Online</span></>
            )}</small>
          </div>
        </div>

        {glass && (
          <div className="ha-glass-tools">
            <button type="button" aria-label={romanian ? 'Conversație nouă' : 'New conversation'} title={romanian ? 'Conversație nouă' : 'New conversation'} onClick={resetConversation} disabled={sending}>
              <RotateCcw size={17}/>
            </button>
            <button type="button" aria-label={expanded ? 'Reduce chat' : 'Extinde chat'} title={expanded ? 'Reduce fereastra' : 'Extinde pe tot ecranul'} aria-pressed={expanded} onClick={() => setExpanded(value => !value)}>
              {expanded ? <Minimize2 size={17}/> : <Maximize2 size={17}/>}
            </button>
            <button type="button" aria-label="About this AI assistant" title="Despre acest asistent AI" aria-expanded={showInfo} aria-controls="ha-assistant-info" onClick={() => setShowInfo(value => !value)}>
              <Info size={17}/>
            </button>
          </div>
        )}
        {!glass && agent.status === 'DEMO' && (
          <span className="ha-badge DEMO" title="Working pre-sales prototype">
            <span className="ha-badge-dot"></span>
            Demo Mode
          </span>
        )}
      </div>

      {glass && showInfo && (
        <div className="ha-glass-info" id="ha-assistant-info" role="note">
          {romanian ? 'Acesta este un asistent AI demonstrativ. Verifică informațiile importante direct cu firma. Nu include date personale sensibile în conversație.' : 'This is an AI demonstration. Verify important details directly with the business. Please avoid sharing sensitive personal information.'}
        </div>
      )}

      {/* Message Area */}
      <div className="ha-chat-messages" ref={messagesViewportRef} role="log" aria-label={romanian ? 'Conversație' : 'Conversation'} aria-live="polite" aria-relevant="additions text">
        {messages.map((m) => (
          <div key={m.id} className={`ha-msg-row ${m.role === 'user' ? 'ha-row-user' : 'ha-row-assistant'}`}>
            {glass && m.role !== 'user' && (
              <span className="ha-message-star" aria-hidden="true">
                <StarliStar size={22} className="ha-star-svg" />
              </span>
            )}
            <div
              className={`ha-msg-bubble ${m.role === 'user' ? 'ha-msg-user' : 'ha-msg-assistant'}`}
              style={!glass && m.role === 'user' && primaryColor ? { background: primaryColor } : undefined}
            >
              {m.content.split('\n\n').map((paragraph, pIdx) => (
                <p key={pIdx} className="ha-msg-paragraph">{paragraph}</p>
              ))}
            </div>
          </div>
        ))}

        {glass && quickPromptButtons}
        {sending && (
          <div className="ha-msg-bubble ha-msg-assistant" style={{ fontStyle: 'italic', color: 'var(--ha-muted)' }}>
            {glass && <LoaderCircle size={14} className="spin"/>} {romanian ? 'Pregătește un răspuns…' : 'Preparing a reply…'}
          </div>
        )}

        {sendError && (
          <div className="ha-msg-bubble ha-msg-system" style={{ color: 'var(--ha-red)', background: 'var(--ha-red-bg)' }}>
            {sendError}
            <button type="button" className="ha-btn ha-btn-sm" disabled={sending} onClick={resetConversation}>Start a new conversation</button>
            {pendingTurn.current && <button type="button" className="ha-btn ha-btn-sm" disabled={sending} onClick={() => handleSendMessage(undefined, pendingTurn.current?.message)}>Retry message</button>}
          </div>
        )}

        {leadNotice && (
          <div className="ha-msg-bubble ha-msg-system" style={{ color: 'var(--ha-green)', background: 'var(--ha-green-bg)' }}>
            ✓ Contact information noted. Our team will follow up as discussed.
          </div>
        )}
      </div>

      {!glass && quickPromptButtons}

      {/* Input Footer */}
      <form className="ha-chat-footer" onSubmit={handleSendMessage}>
        <div className="ha-chat-input-row">
          <input
            type="text"
            maxLength={2000}
            className="ha-chat-input"
            placeholder={appearance.placeholderText || (romanian ? 'Scrie un mesaj...' : 'Write a message...')}
            aria-label={romanian ? 'Mesaj pentru asistent' : 'Message the assistant'}
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            disabled={sending || !!pendingTurn.current || !conversationId || agent.status === 'DISABLED'}
            autoFocus={!embedded && !glass}
          />
          <button
            type="submit"
            className="ha-chat-send-btn"
            style={glass ? undefined : { background: primaryColor }}
            aria-label={romanian ? 'Trimite mesajul' : 'Send message'}
            disabled={!inputText.trim() || sending || !conversationId || agent.status === 'DISABLED'}
          >
            {glass ? <Send size={18}/> : 'Send'}
          </button>
        </div>
        <div className="ha-chat-disclaimer">
          {glass ? (romanian ? 'Creat cu StarliDigital · Asistent AI' : 'Built with StarliDigital · AI assistant') : 'Powered by StarliDigital Hosted Agents · AI conversation'}
        </div>
      </form>
    </div>
  );
}
