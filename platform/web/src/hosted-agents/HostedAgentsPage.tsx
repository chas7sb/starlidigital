import React, { useState, useEffect, useMemo } from 'react';
import type {
  HostedAgent,
  HostedAgentType,
  HostedAgentStatus,
  HostedAgentConversation,
  HostedAgentLead,
  HostedAgentUsage,
  HostedAgentStructuredKnowledge,
  HostedAgentAppearance,
  HostedAgentDeployment
} from './types';
import {
  fetchHostedAgents,
  fetchHostedAgent,
  fetchHostedAgentConversations,
  fetchHostedAgentLeads,
  fetchHostedAgentUsage,
  createHostedAgent,
  updateHostedAgent,
  setHostedAgentKnowledge,
  publishHostedAgent,
  disableHostedAgent,
  assignHostedAgentOwner
} from './client';
import { HostedAgentChat } from './HostedAgentChat';
import './hosted-agents.css';
import { useParams } from 'react-router';
import { knowledgeToForm, knowledgeFromForm } from './knowledge-form';

export interface HostedAgentsPageProps {
  admin?: boolean;
  initialAgentId?: string;
  onNavigateProposal?: (slug: string) => void;
}

export function HostedAgentsPage({
  admin = false,
  initialAgentId,
  onNavigateProposal
}: HostedAgentsPageProps) {
  const routeParams = useParams<{ agentId?: string }>();
  const requestedAgentId = initialAgentId || routeParams.agentId;
  // Navigation & selection
  const [agents, setAgents] = useState<HostedAgent[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(requestedAgentId || null);
  const [activeTab, setActiveTab] = useState<
    'overview' | 'conversations' | 'leads' | 'knowledge' | 'behavior' | 'appearance' | 'installation' | 'usage'
  >('overview');

  // Loading & error states
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  // Selected agent detailed states
  const [conversations, setConversations] = useState<HostedAgentConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [leads, setLeads] = useState<HostedAgentLead[]>([]);
  const [usage, setUsage] = useState<HostedAgentUsage | null>(null);

  // Create modal
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createForm, setCreateForm] = useState({
    name: '',
    businessName: '',
    slug: '',
    type: 'SALES' as HostedAgentType,
    welcomeMessage: 'Hello! How can I assist you with our services today?'
  });

  // Edit forms
  const selectedAgent = useMemo(() => {
    return agents.find((a) => a.id === selectedAgentId) || null;
  }, [agents, selectedAgentId]);

  const [behaviorForm, setBehaviorForm] = useState({
    name: '',
    businessName: '',
    welcomeMessage: '',
    businessContext: '',
    instructions: ''
  });

  const [knowledgeForm, setKnowledgeForm] = useState<HostedAgentStructuredKnowledge>({});
  const [appearanceForm, setAppearanceForm] = useState<HostedAgentAppearance>({});
  const [deploymentForm, setDeploymentForm] = useState<HostedAgentDeployment>({});
  const [targetOwnerId, setTargetOwnerId] = useState('');

  // Initial load
  const loadAgents = async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await fetchHostedAgents(admin);
      setAgents(list);
      if (!selectedAgentId && list.length > 0) {
        setSelectedAgentId(list[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load hosted agents.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgents();
  }, [admin]);

  useEffect(() => {
    if (requestedAgentId) setSelectedAgentId(requestedAgentId);
  }, [requestedAgentId]);

  // Sync edit forms when selected agent changes
  useEffect(() => {
    if (!selectedAgent) return;

    setBehaviorForm({
      name: selectedAgent.name || '',
      businessName: selectedAgent.businessName || '',
      welcomeMessage: selectedAgent.welcomeMessage || '',
      businessContext: selectedAgent.businessContext || '',
      instructions: selectedAgent.instructions || ''
    });

    try {
      setKnowledgeForm(knowledgeToForm(selectedAgent.knowledgeJson || '{}'));
    } catch {
      setKnowledgeForm({});
    }

    try {
      setAppearanceForm(JSON.parse(selectedAgent.appearanceJson || '{}'));
    } catch {
      setAppearanceForm({});
    }

    try {
      setDeploymentForm(JSON.parse(selectedAgent.deploymentJson || '{}'));
    } catch {
      setDeploymentForm({});
    }

    setSaveSuccess(null);
  }, [selectedAgent]);

  // Load secondary tab data (Conversations, Leads, Usage)
  useEffect(() => {
    if (!selectedAgentId) return;
    let active = true;
    setConversations([]); setLeads([]); setUsage(null); setSelectedConversationId(null);

    if (activeTab === 'conversations') {
      fetchHostedAgentConversations(selectedAgentId)
        .then((res) => {
          if (!active) return;
          setConversations(res.items);
          if (res.items.length > 0 && !selectedConversationId) {
            setSelectedConversationId(res.items[0].id);
          }
        })
        .catch(console.error);
    } else if (activeTab === 'leads') {
      fetchHostedAgentLeads(selectedAgentId)
        .then((res) => { if (active) setLeads(res.items); })
        .catch(console.error);
    } else if (activeTab === 'usage' || activeTab === 'overview') {
      fetchHostedAgentUsage(selectedAgentId)
        .then((res) => { if (active) setUsage(res); })
        .catch(console.error);
    }
    return () => { active = false; };
  }, [selectedAgentId, activeTab]);

  // Mutation Handlers
  const handleCreateAgent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createForm.name || !createForm.businessName) return;

    setSaving(true);
    setError(null);
    try {
      const created = await createHostedAgent({
        name: createForm.name,
        businessName: createForm.businessName,
        slug: createForm.slug || undefined,
        type: createForm.type,
        welcomeMessage: createForm.welcomeMessage
      });

      setShowCreateModal(false);
      setCreateForm({
        name: '',
        businessName: '',
        slug: '',
        type: 'SALES',
        welcomeMessage: 'Hello! How can I assist you with our services today?'
      });

      await loadAgents();
      setSelectedAgentId(created.id);
      setActiveTab('knowledge');
    } catch (err: any) {
      setError(err.message || 'Failed to create agent.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveBehavior = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(null);
    try {
      const updated = await updateHostedAgent(
        selectedAgent.id,
        {
          name: behaviorForm.name,
          businessName: behaviorForm.businessName,
          welcomeMessage: behaviorForm.welcomeMessage,
          businessContext: behaviorForm.businessContext,
          instructions: behaviorForm.instructions
        },
        selectedAgent.version
      );
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
      setSaveSuccess('Behavior & purpose settings saved successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to update behavior.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveKnowledge = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(null);
    try {
      const jsonStr = knowledgeFromForm(knowledgeForm, selectedAgent.knowledgeJson);
      const updated = await setHostedAgentKnowledge(selectedAgent.id, jsonStr, selectedAgent.version);
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
      setSaveSuccess('Business knowledge corpus saved successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to update knowledge.');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAppearance = async () => {
    if (!selectedAgent) return;
    setSaving(true);
    setError(null);
    setSaveSuccess(null);
    try {
      const updated = await updateHostedAgent(
        selectedAgent.id,
        { appearanceJson: JSON.stringify(appearanceForm) },
        selectedAgent.version
      );
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
      setSaveSuccess('Appearance configuration saved successfully.');
    } catch (err: any) {
      setError(err.message || 'Failed to update appearance.');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishStatus = async (targetStatus: HostedAgentStatus) => {
    if (!selectedAgent) return;
    setSaving(true);
    setError(null);
    try {
      let updated: HostedAgent;
      if (targetStatus === 'DISABLED') {
        updated = await disableHostedAgent(selectedAgent.id, selectedAgent.version);
      } else {
        updated = await publishHostedAgent(selectedAgent.id, targetStatus, selectedAgent.version);
      }
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
      setSaveSuccess(`Agent status changed to ${targetStatus}.`);
    } catch (err: any) {
      setError(err.message || 'Failed to change status.');
    } finally {
      setSaving(false);
    }
  };

  const handleAssignOwner = async () => {
    if (!selectedAgent || !targetOwnerId.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await assignHostedAgentOwner(selectedAgent.id, targetOwnerId.trim(), selectedAgent.version);
      setAgents((prev) => prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a)));
      setTargetOwnerId('');
      setSaveSuccess(`Agent ownership assigned to ${targetOwnerId}.`);
    } catch (err: any) {
      setError(err.message || 'Failed to assign owner.');
    } finally {
      setSaving(false);
    }
  };

  const selectedConversation = useMemo(() => {
    return conversations.find((c) => c.id === selectedConversationId) || null;
  }, [conversations, selectedConversationId]);

  return (
    <div className="ha-root ha-page-container">
      {/* Top Header */}
      <div className="ha-page-header">
        <div className="ha-title-group">
          <h1>Hosted AI Agents</h1>
          <p>
            {admin
              ? 'Administrator Console: operate, configure, and monitor customer & demo agents.'
              : 'Manage your AI assistant, review captured leads, and update business knowledge.'}
          </p>
        </div>

        <div className="ha-actions-row">
          {admin && (
            <button className="ha-btn ha-btn-primary" onClick={() => setShowCreateModal(true)}>
              + Create Agent
            </button>
          )}

          {selectedAgent && (
            <>
              {selectedAgent.status !== 'ACTIVE' ? (
                <button
                  className="ha-btn ha-btn-primary ha-btn-sm"
                  onClick={() => handlePublishStatus('ACTIVE')}
                  disabled={saving}
                >
                  Activate Live
                </button>
              ) : (
                <button
                  className="ha-btn ha-btn-danger ha-btn-sm"
                  onClick={() => handlePublishStatus('DISABLED')}
                  disabled={saving}
                >
                  Disable Agent
                </button>
              )}

              {selectedAgent.status === 'DRAFT' && (
                <button
                  className="ha-btn ha-btn-outline ha-btn-sm"
                  onClick={() => handlePublishStatus('DEMO')}
                  disabled={saving}
                >
                  Publish as Demo
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="ha-panel" style={{ background: 'var(--ha-red-bg)', borderColor: 'rgba(248, 113, 113, 0.3)', color: 'var(--ha-red)', padding: '12px 16px' }}>
          {error}
        </div>
      )}

      {saveSuccess && (
        <div className="ha-panel" style={{ background: 'var(--ha-green-bg)', borderColor: 'rgba(52, 211, 153, 0.3)', color: 'var(--ha-green)', padding: '12px 16px' }}>
          ✓ {saveSuccess}
        </div>
      )}

      {/* Agent Selector Bar */}
      {agents.length > 1 && (
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', overflowX: 'auto', paddingBottom: '4px' }}>
          <span style={{ fontSize: '12px', color: 'var(--ha-muted)', flexShrink: 0 }}>Active Agent:</span>
          {agents.map((ag) => (
            <button
              key={ag.id}
              className={`ha-btn ha-btn-sm ${ag.id === selectedAgentId ? 'ha-btn-primary' : ''}`}
              onClick={() => setSelectedAgentId(ag.id)}
            >
              <span>{ag.name}</span>
              <span className={`ha-badge ${ag.status}`} style={{ fontSize: '9px', padding: '1px 5px' }}>
                {ag.status}
              </span>
            </button>
          ))}
        </div>
      )}

      {loading && !selectedAgent && (
        <div className="ha-panel" style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--ha-muted)' }}>
          Loading AI Agents...
        </div>
      )}

      {!loading && agents.length === 0 && (
        <div className="ha-panel" style={{ textAlign: 'center', padding: '60px 20px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>🤖</div>
          <strong style={{ fontSize: '16px', display: 'block', marginBottom: '8px' }}>No Hosted Agents Found</strong>
          <p style={{ color: 'var(--ha-muted)', fontSize: '13px', maxWidth: '420px', margin: '0 auto 20px' }}>
            {admin
              ? 'Create a new business agent to demo, configure, or host for a client.'
              : 'Your workspace has not been assigned a live AI agent yet. Contact StarliDigital to activate.'}
          </p>
          {admin && (
            <button className="ha-btn ha-btn-primary" onClick={() => setShowCreateModal(true)}>
              Create First Agent
            </button>
          )}
        </div>
      )}

      {selectedAgent && (
        <>
          {/* Sub Navigation Tabs */}
          <div className="ha-tabs">
            <button
              className={`ha-tab ${activeTab === 'overview' ? 'active' : ''}`}
              onClick={() => setActiveTab('overview')}
            >
              Overview
            </button>
            <button
              className={`ha-tab ${activeTab === 'conversations' ? 'active' : ''}`}
              onClick={() => setActiveTab('conversations')}
            >
              Conversations
            </button>
            <button
              className={`ha-tab ${activeTab === 'leads' ? 'active' : ''}`}
              onClick={() => setActiveTab('leads')}
            >
              Captured Leads
            </button>
            <button
              className={`ha-tab ${activeTab === 'knowledge' ? 'active' : ''}`}
              onClick={() => setActiveTab('knowledge')}
            >
              Knowledge Corpus
            </button>
            <button
              className={`ha-tab ${activeTab === 'behavior' ? 'active' : ''}`}
              onClick={() => setActiveTab('behavior')}
            >
              Behavior & Purpose
            </button>
            <button
              className={`ha-tab ${activeTab === 'appearance' ? 'active' : ''}`}
              onClick={() => setActiveTab('appearance')}
            >
              Appearance
            </button>
            <button
              className={`ha-tab ${activeTab === 'installation' ? 'active' : ''}`}
              onClick={() => setActiveTab('installation')}
            >
              Installation & Embed
            </button>
            <button
              className={`ha-tab ${activeTab === 'usage' ? 'active' : ''}`}
              onClick={() => setActiveTab('usage')}
            >
              Analytics
            </button>
          </div>

          {/* TAB 1: OVERVIEW */}
          {activeTab === 'overview' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              <div className="ha-grid-4">
                <div className="ha-stat-card">
                  <span className="ha-stat-label">Conversations</span>
                  <span className="ha-stat-value">{usage?.conversations ?? 0}</span>
                  <span className="ha-stat-sub">Total chat sessions</span>
                </div>
                <div className="ha-stat-card">
                  <span className="ha-stat-label">Qualified Leads</span>
                  <span className="ha-stat-value" style={{ color: 'var(--ha-green)' }}>
                    {usage?.qualifiedLeads ?? 0}
                  </span>
                  <span className="ha-stat-sub">High-intent visitors</span>
                </div>
                <div className="ha-stat-card">
                  <span className="ha-stat-label">Messages Exchanged</span>
                  <span className="ha-stat-value">{usage?.messages ?? 0}</span>
                  <span className="ha-stat-sub">Inbound & replies</span>
                </div>
                <div className="ha-stat-card">
                  <span className="ha-stat-label">Average Latency</span>
                  <span className="ha-stat-value">
                    {usage?.averageLatencyMs ? `${Math.round(usage.averageLatencyMs)}ms` : '-'}
                  </span>
                  <span className="ha-stat-sub">Model response time</span>
                </div>
              </div>

              <div className="ha-grid-2">
                <div className="ha-panel">
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 14px 0' }}>Agent Status & Endpoints</h3>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', fontSize: '13px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--ha-line)', paddingBottom: '8px' }}>
                      <span style={{ color: 'var(--ha-muted)' }}>Operational Status</span>
                      <span className={`ha-badge ${selectedAgent.status}`}>
                        <span className="ha-badge-dot"></span>
                        {selectedAgent.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--ha-line)', paddingBottom: '8px' }}>
                      <span style={{ color: 'var(--ha-muted)' }}>Business Entity</span>
                      <strong>{selectedAgent.businessName}</strong>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--ha-line)', paddingBottom: '8px' }}>
                      <span style={{ color: 'var(--ha-muted)' }}>Agent Purpose</span>
                      <span>{selectedAgent.type}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--ha-line)', paddingBottom: '8px' }}>
                      <span style={{ color: 'var(--ha-muted)' }}>Public Identifier</span>
                      <code style={{ fontSize: '11px', color: 'var(--ha-accent)' }}>{selectedAgent.publicId}</code>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--ha-muted)' }}>Live Demo URL</span>
                      <a
                        href={`/ai/demo/${selectedAgent.slug}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: 'var(--ha-accent)', textDecoration: 'none' }}
                      >
                        /ai/demo/{selectedAgent.slug} &rarr;
                      </a>
                    </div>
                  </div>

                  {admin && (
                    <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid var(--ha-line)' }}>
                      <span style={{ fontSize: '12px', fontWeight: 500, display: 'block', marginBottom: '8px' }}>
                        Admin: Assign Customer Owner ID
                      </span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          className="ha-input"
                          placeholder="User ID (e.g. usr_123)"
                          value={targetOwnerId}
                          onChange={(e) => setTargetOwnerId(e.target.value)}
                        />
                        <button
                          className="ha-btn ha-btn-sm ha-btn-primary"
                          onClick={handleAssignOwner}
                          disabled={saving || !targetOwnerId.trim()}
                        >
                          Assign
                        </button>
                      </div>
                      <small style={{ fontSize: '10px', color: 'var(--ha-muted)', marginTop: '4px', display: 'block' }}>
                        Current owner: {selectedAgent.ownerId}
                      </small>
                    </div>
                  )}
                </div>

                <div className="ha-panel" style={{ height: '420px', display: 'flex', flexDirection: 'column' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 10px 0' }}>Live Interactive Preview</h3>
                  <div style={{ flex: 1, overflow: 'hidden' }}>
                    <HostedAgentChat publicId={selectedAgent.publicId} embedded={true} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CONVERSATIONS */}
          {activeTab === 'conversations' && (
            <div className="ha-split-layout">
              {/* Left: Session List */}
              <div className="ha-list-pane">
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--ha-line)', fontSize: '12px', color: 'var(--ha-muted)' }}>
                  Total Sessions ({conversations.length})
                </div>
                {conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`ha-list-item ${c.id === selectedConversationId ? 'selected' : ''}`}
                    onClick={() => setSelectedConversationId(c.id)}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                      <strong style={{ fontSize: '13px' }}>Session #{c.id.slice(0, 8)}</strong>
                      <span style={{ fontSize: '11px', color: 'var(--ha-muted)' }}>
                        {new Date(c.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <p style={{ margin: 0, fontSize: '12px', color: 'var(--ha-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.summary || `${c.messages?.length || 0} messages exchanged`}
                    </p>
                    {c.qualification && (
                      <span className="ha-badge ACTIVE" style={{ marginTop: '6px', fontSize: '9px' }}>
                        {c.qualification}
                      </span>
                    )}
                  </div>
                ))}
                {conversations.length === 0 && (
                  <div style={{ padding: '30px 16px', textAlign: 'center', color: 'var(--ha-muted)', fontSize: '12px' }}>
                    No conversations recorded yet.
                  </div>
                )}
              </div>

              {/* Right: Message Transcript */}
              <div className="ha-panel" style={{ display: 'flex', flexDirection: 'column', height: '650px' }}>
                {selectedConversation ? (
                  <>
                    <div style={{ borderBottom: '1px solid var(--ha-line)', paddingBottom: '12px', marginBottom: '16px' }}>
                      <strong style={{ fontSize: '15px' }}>Session Transcript #{selectedConversation.id}</strong>
                      <div style={{ fontSize: '12px', color: 'var(--ha-muted)', marginTop: '4px' }}>
                        Status: {selectedConversation.status} &bull; Started {new Date(selectedConversation.createdAt).toLocaleString()}
                      </div>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px', paddingRight: '8px' }}>
                      {selectedConversation.messages?.map((msg) => (
                        <div
                          key={msg.id}
                          className={`ha-msg-bubble ${msg.role === 'user' ? 'ha-msg-user' : 'ha-msg-assistant'}`}
                        >
                          <div style={{ fontSize: '10px', opacity: 0.8, marginBottom: '4px' }}>
                            {msg.role === 'user' ? 'Visitor' : 'AI Agent'} &bull; {new Date(msg.createdAt).toLocaleTimeString()}
                          </div>
                          {msg.content}
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div style={{ margin: 'auto', color: 'var(--ha-muted)', fontSize: '13px' }}>
                    Select a conversation on the left to read transcript.
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: CAPTURED LEADS */}
          {activeTab === 'leads' && (
            <div className="ha-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h3 style={{ fontSize: '15px', fontWeight: 500, margin: 0 }}>
                  Customer Leads Captured by Agent ({leads.length})
                </h3>
                <span style={{ fontSize: '11px', color: 'var(--ha-muted)' }}>
                  Captured from real conversations via visitor qualification
                </span>
              </div>

              <div className="ha-table-container">
                <table className="ha-table">
                  <thead>
                    <tr>
                      <th>Name / Contact</th>
                      <th>Service / Request</th>
                      <th>Location</th>
                      <th>Budget / Timeframe</th>
                      <th>Score</th>
                      <th>Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leads.map((lead) => (
                      <tr key={lead.id}>
                        <td>
                          <strong>{lead.name || 'Anonymous Prospect'}</strong>
                          <div style={{ fontSize: '11px', color: 'var(--ha-muted)' }}>
                            {lead.email || 'No email'} {lead.phone && `• ${lead.phone}`}
                          </div>
                        </td>
                        <td>
                          <div>{lead.requestedService || '-'}</div>
                          {lead.intent && (
                            <small style={{ color: 'var(--ha-faint)' }}>Intent: {lead.intent}</small>
                          )}
                        </td>
                        <td>{lead.location || '-'}</td>
                        <td>
                          <div>{lead.budget || '-'}</div>
                          <small style={{ color: 'var(--ha-faint)' }}>{lead.timeframe || ''}</small>
                        </td>
                        <td>
                          {lead.score !== null && lead.score !== undefined ? (
                            <span className="ha-badge ACTIVE">{lead.score}/100</span>
                          ) : (
                            '-'
                          )}
                        </td>
                        <td style={{ fontSize: '11px', color: 'var(--ha-muted)' }}>
                          {new Date(lead.createdAt).toLocaleDateString()}
                        </td>
                      </tr>
                    ))}
                    {leads.length === 0 && (
                      <tr>
                        <td colSpan={6} style={{ textAlign: 'center', padding: '36px', color: 'var(--ha-muted)' }}>
                          No leads captured yet. The agent extracts contact & service requests as visitors chat.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: KNOWLEDGE CORPUS */}
          {activeTab === 'knowledge' && (
            <div className="ha-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 4px 0' }}>Factual Business Knowledge</h3>
                  <p style={{ fontSize: '12px', color: 'var(--ha-muted)', margin: 0 }}>
                    Supplied business facts used by the agent to answer questions. The agent will never fabricate details not listed here.
                  </p>
                </div>
                <button className="ha-btn ha-btn-primary" onClick={handleSaveKnowledge} disabled={saving}>
                  Save Knowledge
                </button>
              </div>

              <div className="ha-grid-2">
                <div className="ha-form-group">
                  <label className="ha-label">Company / Business Description</label>
                  <textarea
                    className="ha-textarea"
                    rows={4}
                    placeholder="Describe what the company does, history, core strengths..."
                    value={knowledgeForm.companyDescription || ''}
                    onChange={(e) => setKnowledgeForm({ ...knowledgeForm, companyDescription: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Products & Services Catalog</label>
                  <textarea
                    className="ha-textarea"
                    rows={4}
                    placeholder="One service per line, or a JSON array with name, description, price and features."
                    value={knowledgeForm.productsAndServices || ''}
                    onChange={(e) => setKnowledgeForm({ ...knowledgeForm, productsAndServices: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Pricing Policies & Estimates</label>
                  <textarea
                    className="ha-textarea"
                    rows={3}
                    placeholder="Pricing structures, starting rates, quote guidelines (leave blank if strictly custom)..."
                    value={knowledgeForm.pricingPolicy || ''}
                    onChange={(e) => setKnowledgeForm({ ...knowledgeForm, pricingPolicy: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Locations & Service Areas</label>
                  <textarea
                    className="ha-textarea"
                    rows={3}
                    placeholder="One address per line, or a JSON array with city, address and operatingHours."
                    value={knowledgeForm.locations || ''}
                    onChange={(e) => setKnowledgeForm({ ...knowledgeForm, locations: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Operating Hours & Availability</label>
                  <input
                    type="text"
                    className="ha-input"
                    placeholder="e.g. Mon-Fri 09:00 - 18:00, 24/7 online support"
                    value={knowledgeForm.openingHours || ''}
                    onChange={(e) => setKnowledgeForm({ ...knowledgeForm, openingHours: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Contact & Escalation Channels</label>
                  <input
                    type="text"
                    className="ha-input"
                    placeholder="Direct telephone, email, WhatsApp, booking links..."
                    value={knowledgeForm.contactDetails || ''}
                    onChange={(e) => setKnowledgeForm({ ...knowledgeForm, contactDetails: e.target.value })}
                  />
                </div>
              </div>

              <div className="ha-form-group" style={{ marginTop: '10px' }}>
                <label className="ha-label">Frequently Asked Questions (FAQs)</label>
                <textarea
                  className="ha-textarea"
                  rows={4}
                  placeholder="One FAQ per line: Question | Answer. You can also use a JSON array with question and answer."
                  value={knowledgeForm.frequentlyAskedQuestions || ''}
                  onChange={(e) => setKnowledgeForm({ ...knowledgeForm, frequentlyAskedQuestions: e.target.value })}
                />
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Custom Guardrails & Restrictions</label>
                <textarea
                  className="ha-textarea"
                  rows={3}
                  placeholder="e.g. Never promise exact deadlines without site inspection; direct legal inquiries to office@..."
                  value={knowledgeForm.customRules || ''}
                  onChange={(e) => setKnowledgeForm({ ...knowledgeForm, customRules: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* TAB 5: BEHAVIOR & PURPOSE */}
          {activeTab === 'behavior' && (
            <div className="ha-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 4px 0' }}>Behavior & Qualification Instructions</h3>
                  <p style={{ fontSize: '12px', color: 'var(--ha-muted)', margin: 0 }}>
                    Configure the agent's tone, sales qualification flow, and custom business objectives.
                  </p>
                </div>
                <button className="ha-btn ha-btn-primary" onClick={handleSaveBehavior} disabled={saving}>
                  Save Behavior
                </button>
              </div>

              <div className="ha-grid-2">
                <div className="ha-form-group">
                  <label className="ha-label">Agent Internal Name</label>
                  <input
                    type="text"
                    className="ha-input"
                    value={behaviorForm.name}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, name: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Business Display Name</label>
                  <input
                    type="text"
                    className="ha-input"
                    value={behaviorForm.businessName}
                    onChange={(e) => setBehaviorForm({ ...behaviorForm, businessName: e.target.value })}
                  />
                </div>
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Welcome Message Greeting</label>
                <input
                  type="text"
                  className="ha-input"
                  value={behaviorForm.welcomeMessage}
                  onChange={(e) => setBehaviorForm({ ...behaviorForm, welcomeMessage: e.target.value })}
                />
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Business Context & Role</label>
                <textarea
                  className="ha-textarea"
                  rows={3}
                  placeholder="You are the AI representative for Company. Guide visitors through our services and qualify their needs."
                  value={behaviorForm.businessContext}
                  onChange={(e) => setBehaviorForm({ ...behaviorForm, businessContext: e.target.value })}
                />
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Behavioral Directives & Sales Logic</label>
                <textarea
                  className="ha-textarea"
                  rows={6}
                  placeholder="1. Greet visitors politely.&#10;2. Understand their core requirements.&#10;3. When interested, invite them to share their email or telephone for a personalized quote.&#10;4. Do not pressure visitors aggressively."
                  value={behaviorForm.instructions}
                  onChange={(e) => setBehaviorForm({ ...behaviorForm, instructions: e.target.value })}
                />
              </div>
            </div>
          )}

          {/* TAB 6: APPEARANCE */}
          {activeTab === 'appearance' && (
            <div className="ha-panel">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
                <div>
                  <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 4px 0' }}>Widget Customization</h3>
                  <p style={{ fontSize: '12px', color: 'var(--ha-muted)', margin: 0 }}>
                    Match the chat window to your company's brand identity.
                  </p>
                </div>
                <button className="ha-btn ha-btn-primary" onClick={handleSaveAppearance} disabled={saving}>
                  Save Appearance
                </button>
              </div>

              <div className="ha-grid-2">
                <div className="ha-form-group">
                  <label className="ha-label">Primary Brand Accent Color</label>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <input
                      type="color"
                      value={appearanceForm.primaryColor || '#b8a4ff'}
                      onChange={(e) => setAppearanceForm({ ...appearanceForm, primaryColor: e.target.value })}
                      style={{ width: '40px', height: '36px', border: 0, background: 'none', cursor: 'pointer' }}
                    />
                    <input
                      type="text"
                      className="ha-input"
                      value={appearanceForm.primaryColor || '#b8a4ff'}
                      onChange={(e) => setAppearanceForm({ ...appearanceForm, primaryColor: e.target.value })}
                    />
                  </div>
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Widget Title</label>
                  <input
                    type="text"
                    className="ha-input"
                    placeholder="e.g. Starli AI Assistant"
                    value={appearanceForm.title || ''}
                    onChange={(e) => setAppearanceForm({ ...appearanceForm, title: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Widget Subtitle</label>
                  <input
                    type="text"
                    className="ha-input"
                    placeholder="e.g. Sales & Support Specialist"
                    value={appearanceForm.subtitle || ''}
                    onChange={(e) => setAppearanceForm({ ...appearanceForm, subtitle: e.target.value })}
                  />
                </div>

                <div className="ha-form-group">
                  <label className="ha-label">Chat Input Placeholder</label>
                  <input
                    type="text"
                    className="ha-input"
                    placeholder="e.g. Ask a question or request a quotation..."
                    value={appearanceForm.placeholderText || ''}
                    onChange={(e) => setAppearanceForm({ ...appearanceForm, placeholderText: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}

          {/* TAB 7: INSTALLATION & EMBED */}
          {activeTab === 'installation' && (
            <div className="ha-panel">
              <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 8px 0' }}>Deploy on Your Website</h3>
              <p style={{ fontSize: '13px', color: 'var(--ha-muted)', margin: '0 0 20px 0' }}>
                Paste this one-line script tag into your website's HTML before the closing <code>&lt;/body&gt;</code> tag.
                No third-party libraries or backend servers required.
              </p>

              <div className="ha-form-group">
                <label className="ha-label">Embed Code Snippet</label>
                <div style={{ position: 'relative' }}>
                  <pre
                    style={{
                      background: '#090b10',
                      border: '1px solid var(--ha-line)',
                      padding: '16px',
                      borderRadius: '8px',
                      fontSize: '12px',
                      color: 'var(--ha-accent)',
                      overflowX: 'auto',
                      margin: 0
                    }}
                  >
{`<script
  src="https://starlidigital.ro/agent.js"
  data-agent="${selectedAgent.publicId}"
  defer>
</script>`}
                  </pre>
                  <button
                    className="ha-btn ha-btn-sm"
                    style={{ position: 'absolute', top: '10px', right: '10px' }}
                    onClick={() => {
                      navigator.clipboard.writeText(
`<script src="https://starlidigital.ro/agent.js" data-agent="${selectedAgent.publicId}" defer></script>`
                      );
                      alert('Embed code copied to clipboard!');
                    }}
                  >
                    Copy Script
                  </button>
                </div>
              </div>

              <div style={{ marginTop: '24px' }}>
                <h4 style={{ fontSize: '13px', fontWeight: 500, margin: '0 0 8px 0' }}>Direct Share Links</h4>
                <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                  <a
                    href={`/ai/demo/${selectedAgent.slug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ha-btn ha-btn-sm"
                  >
                    Open Standalone Demo Page &rarr;
                  </a>
                  <a
                    href={`/ai/embed/${selectedAgent.publicId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="ha-btn ha-btn-sm"
                  >
                    Open Clean Iframe Embed View &rarr;
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* TAB 8: USAGE & ANALYTICS */}
          {activeTab === 'usage' && (
            <div className="ha-panel">
              <h3 style={{ fontSize: '15px', fontWeight: 500, margin: '0 0 16px 0' }}>Performance & Utilization</h3>
              <div className="ha-grid-4">
                <div className="ha-stat-card">
                  <span className="ha-stat-label">Model Calls</span>
                  <span className="ha-stat-value">{usage?.modelCalls ?? 0}</span>
                  <span className="ha-stat-sub">Inferences processed</span>
                </div>
                <div className="ha-stat-card">
                  <span className="ha-stat-label">Total Messages</span>
                  <span className="ha-stat-value">{usage?.messages ?? 0}</span>
                  <span className="ha-stat-sub">Across all conversations</span>
                </div>
                <div className="ha-stat-card">
                  <span className="ha-stat-label">System Fallbacks</span>
                  <span className="ha-stat-value">{usage?.failures ?? 0}</span>
                  <span className="ha-stat-sub">Transient provider retries</span>
                </div>
                <div className="ha-stat-card">
                  <span className="ha-stat-label">Avg Speed</span>
                  <span className="ha-stat-value">
                    {usage?.averageLatencyMs ? `${Math.round(usage.averageLatencyMs)}ms` : '-'}
                  </span>
                  <span className="ha-stat-sub">End-to-end latency</span>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Create Agent Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 100,
            padding: '20px'
          }}
        >
          <div className="ha-panel" style={{ width: '100%', maxWidth: '520px', background: 'var(--ha-panel)' }}>
            <h3 style={{ fontSize: '17px', fontWeight: 500, margin: '0 0 16px 0' }}>Create New Hosted Agent</h3>
            <form onSubmit={handleCreateAgent}>
              <div className="ha-form-group">
                <label className="ha-label">Agent Name (Internal)</label>
                <input
                  type="text"
                  className="ha-input"
                  placeholder="e.g. Solar Tech Sales Assistant"
                  value={createForm.name}
                  onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                  required
                />
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Client Business Name</label>
                <input
                  type="text"
                  className="ha-input"
                  placeholder="e.g. Solar Tech SRL"
                  value={createForm.businessName}
                  onChange={(e) => setCreateForm({ ...createForm, businessName: e.target.value })}
                  required
                />
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Public Demo URL Slug (Optional)</label>
                <input
                  type="text"
                  className="ha-input"
                  placeholder="e.g. solar-tech (leave blank for auto)"
                  value={createForm.slug}
                  onChange={(e) => setCreateForm({ ...createForm, slug: e.target.value })}
                />
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Primary Agent Objective</label>
                <select
                  className="ha-select"
                  value={createForm.type}
                  onChange={(e) => setCreateForm({ ...createForm, type: e.target.value as HostedAgentType })}
                >
                  <option value="SALES">AI Sales & Deal Closing</option>
                  <option value="LEAD_QUALIFICATION">Lead Qualification & Screening</option>
                  <option value="SUPPORT">Customer Support & FAQs</option>
                  <option value="BOOKING">Appointment Booking</option>
                  <option value="ECOMMERCE">Ecommerce Product Recommendation</option>
                  <option value="INTERNAL_KNOWLEDGE">Internal Private Knowledge</option>
                  <option value="CUSTOM">Custom Purpose</option>
                </select>
              </div>

              <div className="ha-form-group">
                <label className="ha-label">Initial Welcome Message</label>
                <input
                  type="text"
                  className="ha-input"
                  value={createForm.welcomeMessage}
                  onChange={(e) => setCreateForm({ ...createForm, welcomeMessage: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '24px' }}>
                <button
                  type="button"
                  className="ha-btn"
                  onClick={() => setShowCreateModal(false)}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="ha-btn ha-btn-primary" disabled={saving}>
                  {saving ? 'Creating...' : 'Create Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
