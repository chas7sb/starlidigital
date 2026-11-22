import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Terminal,
  Smartphone,
  Cpu,
  Layers,
  Users,
  Plus,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  Play,
  XCircle,
  Key,
  ExternalLink,
  Code2,
  Trash2,
  Send,
  Eye,
  FileText
} from 'lucide-react';
import { gql } from './api';

export type OperatorTab = 'overview' | 'leads' | 'proposals' | 'devices' | 'jobs' | 'changes' | 'tokens';

export function OperatorConsole({ initialTab = 'overview' }: { initialTab?: OperatorTab }): React.ReactElement {
  const [activeTab, setActiveeTab] = useState<OperatorTab>(initialTab);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [issuedCode, setIssuedCode] = useState<{code:string;slug:string}|null>(null);

  // Data states
  const [platformStatus, setPlatformStatus] = useState<any>(null);
  const [demoBudget, setDemoBudget] = useState<any>(null);
  const [leads, setLeads] = useState<any[]>([]);
  const [proposals, setProposals] = useState<any[]>([]);
  const [devices, setDevices] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [changes, setChanges] = useState<any[]>([]);
  const [tokens, setTokens] = useState<any[]>([]);
  const [messages, setMessages] = useState<any[]>([]);

  // Dialog & form states
  const [newLeadForm, setNewLeadForm] = useState(false);
  const [leadInput, setLeadInput] = useState({
    businessName: '',
    industry: '',
    locality: '',
    phone: '',
    email: '',
    existingWebsite: '',
    source: 'Consola Web Operator',
    consentStatus: 'NONE'
  });

  const [newProposalForm, setNewProposalForm] = useState(false);
  const [proposalInput, setProposalInput] = useState({
    leadId: '',
    summary: 'A modern demo website with menu, location and WhatsApp'
  });

  const [pairingModal, setPairingModal] = useState(false);
  const [pairLabel, setPairLabel] = useState('Windows Office Desktop');
  const [generatedPairCode, setGeneratedPairCode] = useState<any>(null);

  const [powerShellModal, setPowerShellModal] = useState(false);
  const [psCommand, setPsCommand] = useState('');
  const [psReason, setPsReason] = useState('Approved diagnostic operation');
  const [psDeviceId, setPsDeviceId] = useState('');

  const [selectedChange, setSelectedChange] = useState<any>(null);

  async function loadData() {
    setLoading(true);
    setError('');
    try {
      const data = await gql<any>(`
        query {
          operatorPlatformStatus
          operatorDemoBudget { day totalBuilds todayBuilds dailyLimit maxBuildsPerProposal remainingToday }
          operatorLeads { id businessName industry locality normalizedPhone email existingWebsite consentStatus optedOutAt updatedAt }
          operatorProposals { id leadId projectId publicSlug status buildVerified viewCount claimedByUserId updatedAt }
          operatorDevices { id name platform version status adbStatus lastHeartbeatAt allowedRoots adbDevices { serial state model smsCapable } }
          operatorJobs { id kind targetType targetId deviceId status requiresApproval approvedBy output error exitCode updatedAt completedAt }
          operatorPlatformChanges { id title targetPath verificationOk status diff verificationLog updatedAt }
          operatorTokens { id label tokenPrefix permissions expiresAt lastUsedAt revokedAt createdAt }
          operatorMessages { id leadId proposalId kind adapter recipientPhone status body error updatedAt }
        }
      `);
      setPlatformStatus(JSON.parse(data.operatorPlatformStatus || '{}'));
      setDemoBudget(data.operatorDemoBudget);
      setLeads(data.operatorLeads || []);
      setProposals(data.operatorProposals || []);
      setDevices(data.operatorDevices || []);
      setJobs(data.operatorJobs || []);
      setChanges(data.operatorPlatformChanges || []);
      setTokens(data.operatorTokens || []);
      setMessages(data.operatorMessages || []);
    } catch (err: any) {
      setError(err.message || 'Could not load operator data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function handleAddLead(e: React.FormEvent) {
    e.preventDefault();
    try {
      await gql(
        `mutation($input:LeadInput!){
          upsertOperatorLead(input:$input){ id businessName }
        }`,
        { input: {businessName:leadInput.businessName,industry:leadInput.industry,locality:leadInput.locality,phone:leadInput.phone,email:leadInput.email,existingWebsite:leadInput.existingWebsite,consentStatus:leadInput.consentStatus} }
      );
      setNewLeadForm(false);
      setLeadInput({
        businessName: '',
        industry: '',
        locality: '',
        phone: '',
        email: '',
        existingWebsite: '',
        source: 'Consola Web Operator',
        consentStatus: 'NONE'
      });
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreateProposal(e: React.FormEvent) {
    e.preventDefault();
    try {
      const result = await gql<{createOperatorProposal:{proposal:{publicSlug:string};claimCode:string}}>(
        `mutation($input:ProposalCreateInput!){
          createOperatorProposal(input:$input){
            proposal { id publicSlug status }
            claimCode
          }
        }`,
        { input: { leadId: proposalInput.leadId, summary: proposalInput.summary, mode: 'snapshot' } }
      );
      setIssuedCode({code:result.createOperatorProposal.claimCode,slug:result.createOperatorProposal.proposal.publicSlug});
      setNewProposalForm(false);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCreatePairingCode(e: React.FormEvent) {
    e.preventDefault();
    try {
      const res = await gql<any>(
        `mutation($label:String!){
          createDevicePairingCode(label:$label){
            pairingCode label expiresAt
          }
        }`,
        { label: pairLabel }
      );
      setGeneratedPairCode(res.createDevicePairingCode);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleEnqueuePowerShell(e: React.FormEvent) {
    e.preventDefault();
    try {
      await gql(
        `mutation($deviceId:ID!,$command:String!,$reason:String!){
          enqueuePrivilegedPowerShellTask(deviceId:$deviceId,command:$command,reason:$reason){
            id status requiresApproval
          }
        }`,
        { deviceId: psDeviceId, command: psCommand, reason: psReason }
      );
      setPowerShellModal(false);
      setPsCommand('');
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleApproveJob(jobId: string) {
    try {
      await gql(`mutation($jobId:ID!){ approveOperatorJob(jobId:$jobId){ id status } }`, { jobId });
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleCancelJob(jobId: string) {
    try {
      await gql(`mutation($jobId:ID!){ cancelOperatorJob(jobId:$jobId){ id status } }`, { jobId });
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleApproveChange(changeId: string) {
    try {
      await gql(`mutation($changeId:ID!){ approveOperatorPlatformChange(changeId:$changeId){ id status } }`, { changeId });
      setSelectedChange(null);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleRollbackChange(changeId: string) {
    try {
      await gql(`mutation($changeId:ID!){ rollbackOperatorPlatformChange(changeId:$changeId){ id status } }`, { changeId });
      setSelectedChange(null);
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleApproveMessage(messageId: string) {
    try {
      await gql(`mutation($messageId:ID!){ approveOperatorMessage(messageId:$messageId){ id status } }`, { messageId });
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleSendMessage(messageId: string) {
    try {
      await gql(`mutation($messageId:ID!){ dispatchOperatorMessage(messageId:$messageId){ id status error } }`, { messageId });
      await loadData();
    } catch (err: any) {
      setError(err.message);
    }
  }

  return (
    <div className="operator-console-wrapper">
      {error&&<div className="notice error" role="alert">{error}<button className="subtle-button" onClick={()=>void loadData()} disabled={loading}>Retry</button></div>}
      {issuedCode&&<div className="settings-panel" role="status"><h3>Proposal is ready</h3><p>Claim code: <strong>{issuedCode.code}</strong>. Keep it for the invitation; it will not be shown again after reload.</p><a href={'/proposal/'+issuedCode.slug} target="_blank" rel="noreferrer">Open proposal</a><button className="subtle-button" onClick={()=>setIssuedCode(null)}>Close</button></div>}
      {/* Navigation tabs */}
      <div className="operator-subtabs">
        <button className={activeTab === 'overview' ? 'active' : ''} onClick={() => setActiveeTab('overview')}>
          <ShieldCheck size={16} /> Panou General
        </button>
        <button className={activeTab === 'proposals' ? 'active' : ''} onClick={() => setActiveeTab('proposals')}>
          <Layers size={16} /> Client proposals ({proposals.length})
        </button>
        <button className={activeTab === 'leads' ? 'active' : ''} onClick={() => setActiveeTab('leads')}>
          <Users size={16} /> Leaduri ({leads.length})
        </button>
        <button className={activeTab === 'devices' ? 'active' : ''} onClick={() => setActiveeTab('devices')}>
          <Smartphone size={16} /> Devices & ADB ({devices.length})
        </button>
        <button className={activeTab === 'jobs' ? 'active' : ''} onClick={() => setActiveeTab('jobs')}>
          <Cpu size={16} /> Jobs & queue ({jobs.length})
        </button>
        <button className={activeTab === 'changes' ? 'active' : ''} onClick={() => setActiveeTab('changes')}>
          <Code2 size={16} /> Platform changes ({changes.length})
        </button>
        <button className={activeTab === 'tokens' ? 'active' : ''} onClick={() => setActiveeTab('tokens')}>
          <Key size={16} /> Tokens & security ({tokens.length})
        </button>
        <button className="icon-button" onClick={() => void loadData()} title="Refresh">
          <RefreshCw size={15} className={loading ? 'spin' : ''} />
        </button>
      </div>


      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="operator-tab-content">
          <div className="operator-kpi-grid">
            <div className="kpi-card">
              <span className="eyebrow muted">BUGET DEMO AZI</span>
              <div className="kpi-value">
                {demoBudget?.todayBuilds || 0} / {demoBudget?.dailyLimit || 20}
              </div>
              <small>Units remaining today: {demoBudget?.remainingToday ?? 0}</small>
            </div>
            <div className="kpi-card">
              <span className="eyebrow muted">DISPOZITIVE ONLINE</span>
              <div className="kpi-value">{platformStatus?.devicesOnlineCount || 0}</div>
              <small>Conectori Windows WSS activi</small>
            </div>
            <div className="kpi-card">
              <span className="eyebrow muted">PENDING JOBS</span>
              <div className="kpi-value">{platformStatus?.awaitingApprovalJobsCount || 0}</div>
              <small>Requires explicit operator approval</small>
            </div>
            <div className="kpi-card">
              <span className="eyebrow muted">PROPUNERI REVENDICATE</span>
              <div className="kpi-value">
                {proposals.filter((p) => p.status === 'REVENDICAT').length} / {proposals.length}
              </div>
              <small>Transferred to customers</small>
            </div>
          </div>

          <div className="settings-panel">
            <h3>Ubuntu CLI & Conector Windows</h3>
            <p>
              Starli Operator has two entry points: the executable <code>starli</code> on the Ubuntu server (compatible with
              screen/tmux) and the executable <code>starli-device</code> on your Windows computer.
            </p>
            <div className="cli-hint-box">
              <code>starli status</code> • <code>starli chat "Prepare a proposal for…"</code> •{' '}
              <code>starli jobs approve &lt;id&gt;</code>
            </div>
          </div>
        </div>
      )}

      {/* PROPOSALS TAB */}
      {activeTab === 'proposals' && (
        <div className="operator-tab-content">
          <div className="tab-header-actions">
            <div>
              <h3>Customer website proposals</h3>
              <p>Demo websites, verified and ready for customers to claim.</p>
            </div>
            <button className="pill-button light" onClick={() => setNewProposalForm(true)}>
              <Plus size={15} /> New proposal
            </button>
          </div>

          {newProposalForm && (
            <form className="settings-panel inline-form" onSubmit={handleCreateProposal}>
              <h4>Generate demo proposal</h4>
              <label>
                Select lead:
                <select
                  required
                  value={proposalInput.leadId}
                  onChange={(e) => setProposalInput({ ...proposalInput, leadId: e.target.value })}
                >
                  <option value="">-- Select a business --</option>
                  {leads.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.businessName} ({l.locality || '-'}) {l.optedOutAt ? '⚠️ OPTED OUT' : ''}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Request summary / brief:
                <textarea
                  rows={2}
                  required
                  value={proposalInput.summary}
                  onChange={(e) => setProposalInput({ ...proposalInput, summary: e.target.value })}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="pill-button light">
                  Build Next.js demo & screenshots
                </button>
                <button type="button" className="subtle-button" onClick={() => setNewProposalForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="proposals-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business</th>
                  <th>Status</th>
                  <th>Public link</th>
                  <th>Verified build</th>
                  <th>Views</th>
                  <th>Claimed</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {proposals.map((p) => {
                  const lead = leads.find((l) => l.id === p.leadId);
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{lead?.businessName || p.leadId}</strong>
                        <br />
                        <small>{lead?.locality || '-'}</small>
                      </td>
                      <td>
                        <span className={`status-badge ${p.status.toLowerCase()}`}>{p.status}</span>
                      </td>
                      <td>
                        <a
                          href={`/proposal/${p.publicSlug}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-link"
                        >
                          /proposal/{p.publicSlug} <ExternalLink size={12} />
                        </a>
                      </td>
                      <td>
                        {p.buildVerified ? (
                          <span className="text-success">
                            <CheckCircle2 size={15} /> Da
                          </span>
                        ) : (
                          <span className="text-warning">Pending</span>
                        )}
                      </td>
                      <td>{p.viewCount}</td>
                      <td>{p.claimedByUserId ? <span className="text-success">Yes</span> : 'No'}</td>
                      <td>{new Date(p.updatedAt).toLocaleDateString('en-US')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* LEADS TAB */}
      {activeTab === 'leads' && (
        <div className="operator-tab-content">
          <div className="tab-header-actions">
            <div>
              <h3>Leads & contact preferences</h3>
              <p>Deduplication using normalized identifiers, with opt-outs recorded.</p>
            </div>
            <button className="pill-button light" onClick={() => setNewLeadForm(true)}>
              <Plus size={15} /> Add lead
            </button>
          </div>

          {newLeadForm && (
            <form className="settings-panel inline-form" onSubmit={handleAddLead}>
              <h4>Add / update lead</h4>
              <div className="grid-2col">
                <label>
                  Business name:
                  <input
                    required
                    value={leadInput.businessName}
                    onChange={(e) => setLeadInput({ ...leadInput, businessName: e.target.value })}
                  />
                </label>
                <label>
                  Industry:
                  <input
                    value={leadInput.industry}
                    onChange={(e) => setLeadInput({ ...leadInput, industry: e.target.value })}
                  />
                </label>
                <label>
                  Locality:
                  <input
                    value={leadInput.locality}
                    onChange={(e) => setLeadInput({ ...leadInput, locality: e.target.value })}
                  />
                </label>
                <label>
                  Phone:
                  <input
                    value={leadInput.phone}
                    onChange={(e) => setLeadInput({ ...leadInput, phone: e.target.value })}
                    placeholder="+407..."
                  />
                </label>
                <label>
                  Email:
                  <input
                    type="email"
                    value={leadInput.email}
                    onChange={(e) => setLeadInput({ ...leadInput, email: e.target.value })}
                  />
                </label>
                <label>
                  Website existent:
                  <input
                    value={leadInput.existingWebsite}
                    onChange={(e) => setLeadInput({ ...leadInput, existingWebsite: e.target.value })}
                  />
                </label>
              </div>
              <div className="form-actions">
                <button type="submit" className="pill-button light">
                  Save Lead
                </button>
                <button type="button" className="subtle-button" onClick={() => setNewLeadForm(false)}>
                  Cancel
                </button>
              </div>
            </form>
          )}

          <div className="leads-table-wrapper">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Business name</th>
                  <th>Locality</th>
                  <th>Normalized phone</th>
                  <th>Email</th>
                  <th>Mesaje</th>
                  <th>Dezabonat</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <strong>{l.businessName}</strong>
                      <br />
                      <small>{l.industry || '-'}</small>
                    </td>
                    <td>{l.locality || '-'}</td>
                    <td>{l.normalizedPhone || '-'}</td>
                    <td>{l.email || '-'}</td>
                    <td>
                      <span className="status-badge">{l.optedOutAt?'Oprite':'Activee'}</span>
                    </td>
                    <td>
                      {l.optedOutAt ? (
                        <span className="badge danger">
                          <XCircle size={12} /> Refuzat ({new Date(l.optedOutAt).toLocaleDateString('en-US')})
                        </span>
                      ) : (
                        <span className="text-success">Active</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* DEVICES TAB */}
      {activeTab === 'devices' && (
        <div className="operator-tab-content">
          <div className="tab-header-actions">
            <div>
              <h3>Conectori Windows & Devices ADB</h3>
              <p>Secure outbound WebSocket connections, with no public inbound port.</p>
            </div>
            <button className="pill-button light" onClick={() => setPairingModal(true)}>
              <Plus size={15} /> Connect Windows computer
            </button>
          </div>

          <div className="devices-grid">
            {devices.map((d) => (
              <div key={d.id} className="settings-panel device-card">
                <div className="device-header">
                  <Smartphone size={20} />
                  <div>
                    <strong>{d.name}</strong>
                    <br />
                    <small>
                      {d.platform} (v{d.version})
                    </small>
                  </div>
                  <span className={`status-badge ${d.status.toLowerCase()}`}>{d.status}</span>
                </div>
                <div className="device-details">
                  <div>
                    ADB status: <strong>{d.adbStatus}</strong>
                  </div>
                  <div>
                    Telefoane detectate: <strong>{(d.adbDevices || []).length}</strong>
                  </div>
                  <div>
                    Ultimul heartbeat: <small>{d.lastHeartbeatAt ? new Date(d.lastHeartbeatAt).toLocaleTimeString('en-US') : '-'}</small>
                  </div>
                  {d.allowedRoots && (
                    <div>
                      Directoare permise: <small>{d.allowedRoots.join(', ')}</small>
                    </div>
                  )}
                </div>
                <div className="device-actions">
                  <button
                    className="subtle-button"
                    onClick={() => {
                      setPsDeviceId(d.id);
                      setPowerShellModal(true);
                    }}
                  >
                    <Terminal size={14} /> Approved PowerShell execution
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Pairing Code Modal */}
          {pairingModal && (
            <div className="modal-overlay">
              <div className="modal-card">
                <h3>Asociere Dispozitiv Windows</h3>
                <form onSubmit={handleCreatePairingCode}>
                  <label>
                    Device label:
                    <input value={pairLabel} onChange={(e) => setPairLabel(e.target.value)} required />
                  </label>
                  <button type="submit" className="pill-button light full-width">
                    Generate pairing code
                  </button>
                </form>
                {generatedPairCode && (
                  <div className="pair-code-result">
                    <p>Cod temporar generat:</p>
                    <code>{generatedPairCode.pairingCode}</code>
                    <p>Run on Windows:</p>
                    <pre>starli-device pair --code {generatedPairCode.pairingCode}</pre>
                  </div>
                )}
                <button className="subtle-button" onClick={() => setPairingModal(false)}>
                  Close
                </button>
              </div>
            </div>
          )}

          {/* PowerShell Modal */}
          {powerShellModal && (
            <div className="modal-overlay">
              <div className="modal-card">
                <h3>Privileged PowerShell command</h3>
                <p>Requires a reason and approval before execution.</p>
                <form onSubmit={handleEnqueuePowerShell}>
                  <label>
                    Command:
                    <input
                      value={psCommand}
                      onChange={(e) => setPsCommand(e.target.value)}
                      placeholder="Get-Process | Select-Object -First 5"
                      required
                    />
                  </label>
                  <label>
                    Reason:
                    <input value={psReason} onChange={(e) => setPsReason(e.target.value)} required />
                  </label>
                  <button type="submit" className="pill-button light full-width">
                    Create job (approval required)
                  </button>
                </form>
                <button className="subtle-button" onClick={() => setPowerShellModal(false)}>
                  Close
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* JOBS TAB */}
      {activeTab === 'jobs' && (
        <div className="operator-tab-content">
          <h3>Persistent jobs & approvals</h3>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Tip Lucrare</th>
                <th>Dispozitiv</th>
                <th>Status</th>
                <th>Approval required</th>
                <th>Actualizat</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td>
                    <code>{j.kind}</code>
                  </td>
                  <td>{j.deviceId || '-'}</td>
                  <td>
                    <span className={`status-badge ${j.status.toLowerCase()}`}>{j.status}</span>
                  </td>
                  <td>{j.requiresApproval ? (j.approvedBy ? 'Aprobat' : 'Pending') : 'No'}</td>
                  <td>{new Date(j.updatedAt).toLocaleTimeString('en-US')}</td>
                  <td>
                    {j.status === 'AWAITING_APPROVAL' && (
                      <button className="pill-button light" onClick={() => void handleApproveJob(j.id)}>
                        Approve
                      </button>
                    )}
                    {['PENDING', 'RUNNING', 'AWAITING_APPROVAL'].includes(j.status) && (
                      <button className="subtle-button" onClick={() => void handleCancelJob(j.id)}>
                        Cancel
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* PLATFORM CHANGES TAB */}
      {activeTab === 'changes' && (
        <div className="operator-tab-content">
          <h3>Staged platform changes</h3>
          <p>Prepared in an isolated workspace with a diff and checks before applying.</p>
          <div className="changes-list">
            {changes.map((c) => (
              <div key={c.id} className="settings-panel change-card">
                <div className="change-head">
                  <strong>{c.title}</strong>
                  <span className={`status-badge ${c.status.toLowerCase()}`}>{c.status}</span>
                </div>
                <div>
                  Target path: <code>{c.targetPath}</code> | Verification:{' '}
                  <strong>{c.verificationOk ? 'OK' : 'FAILED'}</strong>
                </div>
                <div className="diff-viewer">
                  <pre>{c.diff}</pre>
                </div>
                <div className="change-actions">
                  {c.status === 'STAGED' && (
                    <button className="pill-button light" onClick={() => void handleApproveChange(c.id)}>
                      Approve & apply to production
                    </button>
                  )}
                  {c.status === 'APPROVED_APPLIED' && (
                    <button className="pill-button danger" onClick={() => void handleRollbackChange(c.id)}>
                      Rollback (Revino la original)
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TOKENS TAB */}
      {activeTab === 'tokens' && (
        <div className="operator-tab-content">
          <h3>Active operator tokens</h3>
          <p>Used by the Ubuntu CLI. Tokens expire and can be revoked immediately.</p>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Prefix</th>
                <th>Permissions</th>
                <th>Expires</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {tokens.map((t) => (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td>
                    <code>{t.tokenPrefix}...</code>
                  </td>
                  <td>{(t.permissions || []).join(', ')}</td>
                  <td>{new Date(t.expiresAt).toLocaleDateString('en-US')}</td>
                  <td>
                    {t.revokedAt ? (
                      <span className="badge danger">Revoked</span>
                    ) : (
                      <span className="text-success">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
