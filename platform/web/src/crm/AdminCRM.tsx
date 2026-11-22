import React, { useState, useEffect, useMemo } from 'react';
import type {
  CrmCompany,
  CrmContact,
  CrmSignal,
  CrmOpportunity,
  CrmTask,
  CrmActivity,
  CrmPipelineConfig,
  CrmPipelineMetrics
} from './types';
import './crm.css';

export interface AdminCRMProps {
  initialCompanyId?: string;
  view?: 'prospects' | 'pipeline' | 'tasks' | 'reporting' | 'assets';
  client?: {
    request: (query: string, variables?: Record<string, any>) => Promise<any>;
  };
  currentUserId?: string;
  onNavigateProject?: (projectId: string) => void;
  onNavigateProposal?: (proposalId: string) => void;
  assetPickerAdapter?: {
    onSelectAsset?: (callback: (url: string) => void) => void;
  };
}

export function AdminCRM({
  initialCompanyId,
  view,
  client,
  currentUserId = 'admin',
  onNavigateProject,
  onNavigateProposal,
  assetPickerAdapter
}: AdminCRMProps): React.ReactElement {
  // Navigation tabs
  const [activeTab, setActiveTab] = useState<'prospects' | 'pipeline' | 'tasks' | 'reporting' | 'assets'>('prospects');
  useEffect(() => { if (view) setActiveTab(view); }, [view]);
  
  // Data state
  const [companies, setCompanies] = useState<CrmCompany[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(initialCompanyId || null);
  useEffect(()=>{if(initialCompanyId)setSelectedCompanyId(initialCompanyId);},[initialCompanyId]);
  const [contacts, setContacts] = useState<CrmContact[]>([]);
  const [signals, setSignals] = useState<CrmSignal[]>([]);
  const [opportunities, setOpportunities] = useState<CrmOpportunity[]>([]);
  const [tasks, setTasks] = useState<CrmTask[]>([]);
  const [activities, setActivities] = useState<CrmActivity[]>([]);
  const [pipeline, setPipeline] = useState<CrmPipelineConfig | null>(null);
  const [metrics, setMetrics] = useState<CrmPipelineMetrics | null>(null);
  const [assets, setAssets] = useState<any[]>([]);
  const [savedViews, setSavedViews] = useState<any[]>([]);
  
  // Search & Filter
  const [searchTerm, setSearchTerm] = useState('');
  const [qualificationFilter, setQualificationFilter] = useState('');
  
  // Loading & Error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Modals
  const [showCreateCompanyModal, setShowCreateCompanyModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showNewDealModal, setShowNewDealModal] = useState(false);
  const [showNewTaskModal, setShowNewTaskModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);

  // Form states
  const [companyForm, setCompanyForm] = useState({ name: '', domain: '', industry: '', email: '', phone: '', qualificationStatus: 'UNQUALIFIED' });
  const [dealForm, setDealForm] = useState({ title: '', amount: 1500, currency: 'EUR', stageId: 'discovery' });
  const [taskForm, setTaskForm] = useState({ title: '', priority: 'MEDIUM', dueDate: '' });
  const [noteForm, setNoteForm] = useState({ summary: '', details: '' });
  const [csvContent, setCsvContent] = useState('');
  const [csvPreview, setCsvPreview] = useState<any>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');

  // Execution helper for GraphQL queries
  const executeQuery = async (query: string, vars?: any) => {
    if (!client) {
      // Fallback to fetch /graphql if client not passed
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables: vars })
      });
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json.data;
    }
    return client.request(query, vars);
  };

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await executeQuery(`
        query LoadCrmData {
          crmPipeline {
            id name version
            stages { id name order probability isTerminalWon isTerminalLost }
          }
          crmCompanies {
            id name domain industry locality email phone qualificationStatus
            tags legacyLeadId proposalId projectId version createdAt updatedAt
          }
          crmOpportunities {
            id companyId title amount currency stageId probability status
            wonReason lostReason projectId proposalId legacyLeadId version updatedAt
          }
          crmTasks {
            id companyId opportunityId contactId title description dueDate priority status version
          }
          crmPipelineMetrics {
            totalOpenCount totalOpenValueByCurrencyJson
            totalWonCount totalWonValueByCurrencyJson
            totalLostCount
            stageBreakdown { stageId stageName count valueByCurrencyJson probabilityWeightedValueByCurrencyJson }
            wonReasonsBreakdownJson lostReasonsBreakdownJson
          }
          crmSavedViews {
            id name target filtersJson sortField sortDirection isShared version
          }
        }
      `);
      setPipeline(data.crmPipeline);
      setCompanies(data.crmCompanies);
      setOpportunities(data.crmOpportunities);
      setTasks(data.crmTasks);
      setMetrics(data.crmPipelineMetrics);
      setSavedViews(data.crmSavedViews || []);
      if (!selectedCompanyId && data.crmCompanies.length > 0) {
        setSelectedCompanyId(data.crmCompanies[0].id);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load CRM data');
    } finally {
      setLoading(false);
    }
  };

  const loadCompanyDetails = async (compId: string) => {
    try {
      const data = await executeQuery(`
        query LoadCompanyDetails($compId: String!) {
          crmContacts(companyId: $compId) {
            id companyId firstName lastName fullName email phone roleTitle isPrimary version
          }
          crmSignals(companyId: $compId) {
            id companyId source kind title summary evidenceUrl confidenceScore verified version createdAt
          }
          crmActivities(companyId: $compId) {
            id kind actorPrincipal occurredAt companyId opportunityId visibility summary details version createdAt
          }
          assets(prospectId: $compId) {
            id sha256 mimeType byteSize filenameHint altText visibility url createdAt
          }
        }
      `, { compId });
      setContacts(data.crmContacts);
      setSignals(data.crmSignals);
      setActivities(data.crmActivities);
      setAssets(data.assets || []);
    } catch (err: any) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (selectedCompanyId) {
      loadCompanyDetails(selectedCompanyId);
    }
  }, [selectedCompanyId]);

  const selectedCompany = useMemo(() => {
    return companies.find(c => c.id === selectedCompanyId) || null;
  }, [companies, selectedCompanyId]);

  const filteredCompanies = useMemo(() => {
    return companies.filter(c => {
      if (qualificationFilter && c.qualificationStatus !== qualificationFilter) return false;
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesName = c.name.toLowerCase().includes(term);
        const matchesDomain = c.domain?.toLowerCase().includes(term);
        const matchesEmail = c.email?.toLowerCase().includes(term);
        return matchesName || matchesDomain || matchesEmail;
      }
      return true;
    });
  }, [companies, searchTerm, qualificationFilter]);

  // Handlers
  const handleNoteWithAsset = async (assetUrl: string) => {
    if (!selectedCompanyId) return;
    try {
      await executeQuery(`
        mutation AddNote($companyId: String, $summary: String!, $details: String) {
          crmAddActivityNote(companyId: $companyId, summary: $summary, details: $details) { id summary }
        }
      `, {
        companyId: selectedCompanyId,
        summary: 'Attached generated asset/image',
        details: assetUrl
      });
      await loadCompanyDetails(selectedCompanyId);
    } catch (err: any) {
      alert(`Error linking asset: ${err.message}`);
    }
  };

  const handleCreateCompany = async () => {
    try {
      await executeQuery(`
        mutation CreateCompany($input: CrmCompanyInput!) {
          crmUpsertCompany(input: $input) { id name version }
        }
      `, { input: companyForm });
      setShowCreateCompanyModal(false);
      setCompanyForm({ name: '', domain: '', industry: '', email: '', phone: '', qualificationStatus: 'UNQUALIFIED' });
      await loadData();
    } catch (err: any) {
      alert(`Error creating company: ${err.message}`);
    }
  };

  const handleCreateDeal = async () => {
    if (!selectedCompanyId) return;
    try {
      await executeQuery(`
        mutation CreateDeal($input: CrmOpportunityInput!) {
          crmUpsertOpportunity(input: $input) { id title version }
        }
      `, {
        input: {
          companyId: selectedCompanyId,
          title: dealForm.title,
          amount: parseFloat(String(dealForm.amount)),
          currency: dealForm.currency,
          stageId: dealForm.stageId
        }
      });
      setShowNewDealModal(false);
      setDealForm({ title: '', amount: 1500, currency: 'EUR', stageId: 'discovery' });
      await loadData();
      if (selectedCompanyId) await loadCompanyDetails(selectedCompanyId);
    } catch (err: any) {
      alert(`Error creating deal: ${err.message}`);
    }
  };

  const handleCreateTask = async () => {
    if (!selectedCompanyId) return;
    try {
      await executeQuery(`
        mutation CreateTask($input: CrmTaskInput!) {
          crmUpsertTask(input: $input) { id title version }
        }
      `, {
        input: {
          companyId: selectedCompanyId,
          title: taskForm.title,
          priority: taskForm.priority,
          dueDate: taskForm.dueDate || null
        }
      });
      setShowNewTaskModal(false);
      setTaskForm({ title: '', priority: 'MEDIUM', dueDate: '' });
      await loadData();
    } catch (err: any) {
      alert(`Error creating task: ${err.message}`);
    }
  };

  const handleAddNote = async () => {
    if (!selectedCompanyId || !noteForm.summary.trim()) return;
    try {
      await executeQuery(`
        mutation AddNote($companyId: String, $summary: String!, $details: String) {
          crmAddActivityNote(companyId: $companyId, summary: $summary, details: $details) { id summary }
        }
      `, {
        companyId: selectedCompanyId,
        summary: noteForm.summary,
        details: noteForm.details
      });
      setNoteForm({ summary: '', details: '' });
      await loadCompanyDetails(selectedCompanyId);
    } catch (err: any) {
      alert(`Error adding note: ${err.message}`);
    }
  };

  const handlePreviewCsv = async () => {
    if (!csvContent.trim()) return;
    try {
      const data = await executeQuery(`
        query PreviewCsv($csvContent: String!) {
          crmPreviewCsvImport(csvContent: $csvContent) {
            totalRows validRows duplicateCount
            rows { rowIndex name domain email phone industry isDuplicate duplicateReason }
          }
        }
      `, { csvContent });
      setCsvPreview(data.crmPreviewCsvImport);
    } catch (err: any) {
      alert(`Preview error: ${err.message}`);
    }
  };

  const handleExecuteCsv = async (skipDuplicates: boolean) => {
    try {
      const data = await executeQuery(`
        mutation ExecuteCsv($csvContent: String!, $skipDuplicates: Boolean!) {
          crmExecuteCsvImport(csvContent: $csvContent, skipDuplicates: $skipDuplicates) {
            importedCount skippedCount
          }
        }
      `, { csvContent, skipDuplicates });
      alert(`Import completed! Imported: ${data.crmExecuteCsvImport.importedCount}, Skipped: ${data.crmExecuteCsvImport.skippedCount}`);
      setShowImportModal(false);
      setCsvContent('');
      setCsvPreview(null);
      await loadData();
    } catch (err: any) {
      alert(`Import error: ${err.message}`);
    }
  };

  const handleExportCsv = async () => {
    try {
      const data = await executeQuery(`
        query ExportCsv {
          crmExportCompaniesCsv
        }
      `);
      const blob = new Blob([data.crmExportCompaniesCsv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `crm_export_${new Date().toISOString().slice(0,10)}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err: any) {
      alert(`Export error: ${err.message}`);
    }
  };

  const handleMoveDealStage = async (opp: CrmOpportunity, newStageId: string) => {
    try {
      await executeQuery(`
        mutation MoveStage($input: CrmOpportunityInput!, $expectedVersion: Int) {
          crmUpsertOpportunity(input: $input, expectedVersion: $expectedVersion) { id stageId version }
        }
      `, {
        input: {
          id: opp.id,
          companyId: opp.companyId,
          title: opp.title,
          amount: opp.amount,
          currency: opp.currency,
          stageId: newStageId
        },
        expectedVersion: opp.version
      });
      await loadData();
    } catch (err: any) {
      alert(`Conflict or error moving deal: ${err.message}`);
      await loadData(); // refresh on conflict
    }
  };

  const handleMerge = async () => {
    if (!selectedCompany || !mergeTargetId) return;
    const targetComp = companies.find(c => c.id === mergeTargetId);
    if (!targetComp) return;

    if (!confirm(`Are you sure you want to merge "${selectedCompany.name}" into "${targetComp.name}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await executeQuery(`
        mutation MergeCompanies($targetId: String!, $sourceId: String!, $expectedTargetVersion: Int!, $expectedSourceVersion: Int!) {
          crmMergeCompanies(
            targetCompanyId: $targetId,
            sourceCompanyId: $sourceId,
            expectedTargetVersion: $expectedTargetVersion,
            expectedSourceVersion: $expectedSourceVersion
          ) { id name version }
        }
      `, {
        targetId: targetComp.id,
        sourceId: selectedCompany.id,
        expectedTargetVersion: targetComp.version,
        expectedSourceVersion: selectedCompany.version
      });
      setShowMergeModal(false);
      setMergeTargetId('');
      setSelectedCompanyId(targetComp.id);
      await loadData();
    } catch (err: any) {
      alert(`Merge error: ${err.message}`);
    }
  };

  return (
    <div className="crm-container">
      {/* Top Header */}
      <div className="crm-header">
        <div className="crm-header-title">
          <h2>Admin CRM & Pipeline</h2>
          <span className="crm-badge-pro">Operations Console</span>
        </div>
        <div className="crm-tabs">
          <button
            className={`crm-tab-btn ${activeTab === 'prospects' ? 'active' : ''}`}
            onClick={() => setActiveTab('prospects')}
          >
            Prospects & Accounts
          </button>
          <button
            className={`crm-tab-btn ${activeTab === 'pipeline' ? 'active' : ''}`}
            onClick={() => setActiveTab('pipeline')}
          >
            Deals & Pipeline
          </button>
          <button
            className={`crm-tab-btn ${activeTab === 'tasks' ? 'active' : ''}`}
            onClick={() => setActiveTab('tasks')}
          >
            Tasks & Reminders
          </button>
          <button
            className={`crm-tab-btn ${activeTab === 'reporting' ? 'active' : ''}`}
            onClick={() => setActiveTab('reporting')}
          >
            Outcome Reporting
          </button>
          <button
            className={`crm-tab-btn ${activeTab === 'assets' ? 'active' : ''}`}
            onClick={() => setActiveTab('assets')}
          >
            Asset Gallery
          </button>
        </div>
        <div className="crm-actions">
          <button className="crm-btn crm-btn-primary" onClick={() => setShowCreateCompanyModal(true)}>
            + Add Prospect
          </button>
          <button className="crm-btn" onClick={() => setShowImportModal(true)}>
            CSV Import
          </button>
          <button className="crm-btn" onClick={handleExportCsv}>
            Export CSV
          </button>
        </div>
      </div>

      {/* Metrics Strip */}
      {metrics && (
        <div className="crm-metrics-strip">
          <div className="crm-metric-card">
            <span className="crm-metric-label">Active Prospects</span>
            <span className="crm-metric-value">{companies.length}</span>
            <span className="crm-metric-sub">Across all qualification states</span>
          </div>
          <div className="crm-metric-card">
            <span className="crm-metric-label">Open Deals Value</span>
            <span className="crm-metric-value">
              {metrics.totalOpenValueByCurrencyJson ? (
                Object.entries(JSON.parse(metrics.totalOpenValueByCurrencyJson)).map(([curr, val]) => (
                  <span key={curr}>{val as number} {curr} </span>
                ))
              ) : '0 EUR'}
            </span>
            <span className="crm-metric-sub">{metrics.totalOpenCount} deals in flight</span>
          </div>
          <div className="crm-metric-card">
            <span className="crm-metric-label">Closed Won Revenue</span>
            <span className="crm-metric-value" style={{ color: '#34d399' }}>
              {metrics.totalWonValueByCurrencyJson ? (
                Object.entries(JSON.parse(metrics.totalWonValueByCurrencyJson)).map(([curr, val]) => (
                  <span key={curr}>{val as number} {curr} </span>
                ))
              ) : '0 EUR'}
            </span>
            <span className="crm-metric-sub">{metrics.totalWonCount} won deals recorded</span>
          </div>
          <div className="crm-metric-card">
            <span className="crm-metric-label">Pending Tasks</span>
            <span className="crm-metric-value" style={{ color: '#fbbf24' }}>
              {tasks.filter(t => t.status !== 'COMPLETED').length}
            </span>
            <span className="crm-metric-sub">Awaiting action</span>
          </div>
        </div>
      )}

      {error && (
        <div style={{ background: '#7f1d1d', color: '#fecaca', padding: '0.75rem', borderRadius: '0.375rem', marginBottom: '1rem' }}>
          {error}
        </div>
      )}

      {/* Main Content Area */}
      {activeTab === 'prospects' && (
        <div className="crm-content-layout">
          {/* Main List */}
          <div className="crm-main-pane">
            <div className="crm-filter-bar">
              <input
                type="text"
                className="crm-input"
                placeholder="Search by company, domain, email..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                style={{ minWidth: '240px' }}
              />
              <select
                className="crm-input"
                value={qualificationFilter}
                onChange={e => setQualificationFilter(e.target.value)}
              >
                <option value="">All Qualification States</option>
                <option value="UNQUALIFIED">Unqualified</option>
                <option value="QUALIFYING">Qualifying</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="DISQUALIFIED">Disqualified</option>
              </select>
            </div>
            <div className="crm-table-container">
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Company Name</th>
                    <th>Domain / Website</th>
                    <th>Status</th>
                    <th>Locality</th>
                    <th>Links</th>
                    <th>Version</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompanies.map(c => (
                    <tr
                      key={c.id}
                      className={c.id === selectedCompanyId ? 'selected' : ''}
                      onClick={() => setSelectedCompanyId(c.id)}
                    >
                      <td style={{ fontWeight: 600 }}>{c.name}</td>
                      <td>{c.domain || c.website || '-'}</td>
                      <td>
                        <span className={`crm-pill ${
                          c.qualificationStatus === 'QUALIFIED' ? 'crm-pill-green' :
                          c.qualificationStatus === 'QUALIFYING' ? 'crm-pill-blue' :
                          c.qualificationStatus === 'DISQUALIFIED' ? 'crm-pill-amber' : 'crm-pill-gray'
                        }`}>
                          {c.qualificationStatus}
                        </span>
                      </td>
                      <td>{c.locality || '-'}</td>
                      <td>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          {c.projectId && <span className="crm-pill crm-pill-blue" title="Connected Project">Proj</span>}
                          {c.proposalId && <span className="crm-pill crm-pill-green" title="Connected Proposal">Prop</span>}
                          {c.legacyLeadId && <span className="crm-pill crm-pill-gray" title="Legacy Lead">Lead</span>}
                        </div>
                      </td>
                      <td style={{ color: '#64748b' }}>v{c.version}</td>
                    </tr>
                  ))}
                  {filteredCompanies.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ textAlign: 'center', padding: '2rem', color: '#64748b' }}>
                        No prospects found matching your search.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Right Detail Panel */}
          {selectedCompany && (
            <div className="crm-detail-pane">
              <div className="crm-detail-header">
                <div>
                  <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#f8fafc' }}>{selectedCompany.name}</h3>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                    {selectedCompany.domain || 'No website'} &bull; v{selectedCompany.version}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="crm-btn crm-btn-sm" onClick={() => setShowMergeModal(true)}>
                    Merge
                  </button>
                </div>
              </div>

              <div className="crm-detail-body">
                {/* Legacy & Project Links */}
                <div className="crm-section">
                  <span className="crm-section-title">Connected Platform Records</span>
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                    {selectedCompany.projectId ? (
                      <button
                        className="crm-btn crm-btn-sm crm-btn-primary"
                        onClick={() => onNavigateProject?.(selectedCompany.projectId!)}
                      >
                        Open Project ({selectedCompany.projectId.slice(0, 8)})
                      </button>
                    ) : (
                      <span style={{ fontSize: '0.8rem', color: '#64748b' }}>No active project</span>
                    )}
                    {selectedCompany.proposalId && (
                      <button
                        className="crm-btn crm-btn-sm"
                        onClick={() => onNavigateProposal?.(selectedCompany.proposalId!)}
                      >
                        Open Proposal
                      </button>
                    )}
                    {selectedCompany.legacyLeadId && (
                      <span className="crm-pill crm-pill-gray" style={{ alignSelf: 'center' }}>
                        Lead #{selectedCompany.legacyLeadId}
                      </span>
                    )}
                  </div>
                </div>

                {/* Contacts Section */}
                <div className="crm-section">
                  <span className="crm-section-title">Contacts ({contacts.length})</span>
                  {contacts.map(ct => (
                    <div key={ct.id} style={{ background: '#0f172a', padding: '0.5rem', borderRadius: '0.375rem', fontSize: '0.85rem' }}>
                      <div style={{ fontWeight: 600, display: 'flex', justifyContent: 'space-between' }}>
                        <span>{ct.fullName}</span>
                        {ct.isPrimary && <span className="crm-pill crm-pill-blue">Primary</span>}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                        {ct.email || 'No email'} {ct.phone && `• ${ct.phone}`} {ct.roleTitle && `• ${ct.roleTitle}`}
                      </div>
                    </div>
                  ))}
                  {contacts.length === 0 && <span style={{ fontSize: '0.8rem', color: '#64748b' }}>No contacts registered.</span>}
                </div>

                {/* Evidence & Signals */}
                <div className="crm-section">
                  <span className="crm-section-title">Research Evidence & Signals ({signals.length})</span>
                  {signals.map(sig => (
                    <div key={sig.id} style={{ background: '#0f172a', padding: '0.5rem', borderRadius: '0.375rem', fontSize: '0.85rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontWeight: 600 }}>{sig.title}</span>
                        {sig.verified ? (
                          <span className="crm-pill crm-pill-green">Verified</span>
                        ) : (
                          <span className="crm-pill crm-pill-amber">Unverified</span>
                        )}
                      </div>
                      <p style={{ margin: '0.25rem 0', color: '#cbd5e1', fontSize: '0.8rem' }}>{sig.summary}</p>
                      {sig.evidenceUrl && (
                        <a href={sig.evidenceUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#38bdf8', fontSize: '0.75rem' }}>
                          View Evidence URL &rarr;
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                {/* Linked Assets & Visual Media */}
                <div className="crm-section">
                  <div className="crm-section-title">
                    <span>Generated Images & Assets ({assets.length})</span>
                    {assetPickerAdapter?.onSelectAsset && (
                      <button
                        className="crm-btn crm-btn-sm"
                        onClick={() => assetPickerAdapter.onSelectAsset?.((url) => {
                          handleNoteWithAsset(url);
                        })}
                      >
                        + Attach Asset
                      </button>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: '0.5rem' }}>
                    {assets.map(a => (
                      <div key={a.id} style={{ position: 'relative', background: '#0f172a', borderRadius: '0.25rem', overflow: 'hidden', border: '1px solid #334155' }}>
                        <img
                          src={a.url}
                          alt={a.altText || 'Prospect asset'}
                          style={{ width: '100%', height: '70px', objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{ padding: '0.2rem', fontSize: '0.65rem', color: '#94a3b8', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {a.filenameHint || a.id.slice(0, 8)}
                        </div>
                      </div>
                    ))}
                  </div>
                  {assets.length === 0 && <span style={{ fontSize: '0.8rem', color: '#64748b' }}>No assets attached.</span>}
                </div>

                {/* Deals / Opportunities */}
                <div className="crm-section">
                  <div className="crm-section-title">
                    <span>Deals / Opportunities</span>
                    <button className="crm-btn crm-btn-sm crm-btn-primary" onClick={() => setShowNewDealModal(true)}>
                      + Deal
                    </button>
                  </div>
                  {opportunities.filter(o => o.companyId === selectedCompany.id).map(opp => (
                    <div key={opp.id} style={{ background: '#0f172a', padding: '0.6rem', borderRadius: '0.375rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600 }}>
                        <span>{opp.title}</span>
                        <span>{opp.amount} {opp.currency}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: '#94a3b8', marginTop: '0.25rem' }}>
                        <span>Stage: {opp.stageId}</span>
                        <span className={`crm-pill ${opp.status === 'WON' ? 'crm-pill-green' : opp.status === 'LOST' ? 'crm-pill-amber' : 'crm-pill-blue'}`}>
                          {opp.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Activity & Timeline */}
                <div className="crm-section">
                  <div className="crm-section-title">
                    <span>Activity & Timeline</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <input
                      type="text"
                      className="crm-input"
                      placeholder="Add quick note summary..."
                      value={noteForm.summary}
                      onChange={e => setNoteForm({ ...noteForm, summary: e.target.value })}
                    />
                    <textarea
                      className="crm-input"
                      placeholder="Details (optional)..."
                      rows={2}
                      value={noteForm.details}
                      onChange={e => setNoteForm({ ...noteForm, details: e.target.value })}
                    />
                    <button className="crm-btn crm-btn-sm" onClick={handleAddNote}>
                      Post Activity Note
                    </button>
                  </div>

                  <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    {activities.map(act => (
                      <div key={act.id} style={{ borderLeft: '2px solid #475569', paddingLeft: '0.5rem', fontSize: '0.8rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8' }}>
                          <span>{act.actorPrincipal} &bull; {act.kind}</span>
                          <span>{new Date(act.occurredAt).toLocaleDateString()}</span>
                        </div>
                        <div style={{ fontWeight: 500, color: '#f8fafc', marginTop: '0.1rem' }}>
                          {act.summary}
                        </div>
                        {act.details && <div style={{ color: '#cbd5e1', fontSize: '0.75rem' }}>{act.details}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Kanban Board View */}
      {activeTab === 'pipeline' && (
        <div className="crm-kanban-board">
          {pipeline?.stages.map(stage => {
            const stageOpps = opportunities.filter(o => o.stageId === stage.id);
            const totalStageVal = stageOpps.reduce((acc, curr) => acc + curr.amount, 0);

            return (
              <div key={stage.id} className="crm-kanban-col">
                <div className="crm-kanban-col-header">
                  <div>
                    <span>{stage.name}</span>
                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: 400 }}>
                      {totalStageVal} EUR &bull; {stage.probability}%
                    </div>
                  </div>
                  <span className="crm-kanban-col-count">{stageOpps.length}</span>
                </div>
                <div className="crm-kanban-cards">
                  {stageOpps.map(opp => {
                    const comp = companies.find(c => c.id === opp.companyId);
                    return (
                      <div key={opp.id} className="crm-kanban-card">
                        <div style={{ fontWeight: 600, fontSize: '0.875rem' }}>{opp.title}</div>
                        <div style={{ fontSize: '0.75rem', color: '#38bdf8', marginTop: '0.2rem' }}>
                          {comp?.name || 'Unknown Company'}
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem' }}>
                          <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{opp.amount} {opp.currency}</span>
                          <select
                            className="crm-input"
                            style={{ padding: '0.1rem 0.3rem', fontSize: '0.7rem' }}
                            value={opp.stageId}
                            onChange={e => handleMoveDealStage(opp, e.target.value)}
                          >
                            {pipeline.stages.map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Tasks View */}
      {activeTab === 'tasks' && (
        <div className="crm-main-pane">
          <div className="crm-filter-bar">
            <button className="crm-btn crm-btn-primary" onClick={() => setShowNewTaskModal(true)}>
              + Create Task
            </button>
          </div>
          <div className="crm-table-container">
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Task Title</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Due Date</th>
                  <th>Target Company</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map(t => {
                  const comp = companies.find(c => c.id === t.companyId);
                  return (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600 }}>{t.title}</td>
                      <td>
                        <span className={`crm-pill ${
                          t.priority === 'URGENT' ? 'crm-pill-amber' :
                          t.priority === 'HIGH' ? 'crm-pill-amber' : 'crm-pill-gray'
                        }`}>
                          {t.priority}
                        </span>
                      </td>
                      <td>
                        <span className={`crm-pill ${t.status === 'COMPLETED' ? 'crm-pill-green' : 'crm-pill-blue'}`}>
                          {t.status}
                        </span>
                      </td>
                      <td>{t.dueDate || '-'}</td>
                      <td>{comp?.name || '-'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Outcome Reporting View */}
      {activeTab === 'reporting' && metrics && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', overflowY: 'auto' }}>
          <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '0.5rem', padding: '1.5rem' }}>
            <h3 style={{ margin: '0 0 1rem 0' }}>Pipeline Conversion by Stage (Ground Truth)</h3>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Stage</th>
                  <th>Deals Count</th>
                  <th>Total Face Value</th>
                  <th>Probability-Weighted Value</th>
                </tr>
              </thead>
              <tbody>
                {metrics.stageBreakdown.map(st => {
                  const valObj = JSON.parse(st.valueByCurrencyJson || '{}');
                  const weightedObj = JSON.parse(st.probabilityWeightedValueByCurrencyJson || '{}');
                  return (
                    <tr key={st.stageId}>
                      <td style={{ fontWeight: 600 }}>{st.stageName}</td>
                      <td>{st.count}</td>
                      <td>
                        {Object.entries(valObj).map(([curr, val]) => `${val} ${curr}`).join(', ') || '0 EUR'}
                      </td>
                      <td style={{ color: '#38bdf8' }}>
                        {Object.entries(weightedObj).map(([curr, val]) => `${Number(val).toFixed(0)} ${curr}`).join(', ') || '0 EUR'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '0.5rem', padding: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem 0', color: '#34d399' }}>Won Deal Reasons</h4>
              {Object.entries(JSON.parse(metrics.wonReasonsBreakdownJson || '{}')).map(([reason, count]) => (
                <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #334155' }}>
                  <span>{reason}</span>
                  <span style={{ fontWeight: 600 }}>{count as number}</span>
                </div>
              ))}
            </div>

            <div style={{ background: '#1e293b', border: '1px solid #334155', borderRadius: '0.5rem', padding: '1.5rem' }}>
              <h4 style={{ margin: '0 0 1rem 0', color: '#fbbf24' }}>Lost Deal Reasons</h4>
              {Object.entries(JSON.parse(metrics.lostReasonsBreakdownJson || '{}')).map(([reason, count]) => (
                <div key={reason} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0', borderBottom: '1px solid #334155' }}>
                  <span>{reason}</span>
                  <span style={{ fontWeight: 600 }}>{count as number}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Asset Gallery Tab */}
      {activeTab === 'assets' && (
        <div className="crm-main-pane" style={{ padding: '1.5rem', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
            <div>
              <h3 style={{ margin: 0 }}>Deterministic Generated Assets & Media</h3>
              <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                Images and generated raster files uploaded deterministically via MCP tools or admin upload.
              </p>
            </div>
            {assetPickerAdapter?.onSelectAsset && (
              <button
                className="crm-btn crm-btn-primary"
                onClick={() => assetPickerAdapter.onSelectAsset?.(() => loadData())}
              >
                + Upload / Ingest Asset
              </button>
            )}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1.5rem' }}>
            {assets.map(asset => (
              <div key={asset.id} style={{ background: '#0f172a', border: '1px solid #334155', borderRadius: '0.5rem', overflow: 'hidden' }}>
                <div style={{ width: '100%', height: '140px', background: '#1e293b', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <img
                    src={asset.url}
                    alt={asset.altText || 'Asset'}
                    style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                  />
                </div>
                <div style={{ padding: '0.75rem', fontSize: '0.8rem' }}>
                  <div style={{ fontWeight: 600, color: '#f8fafc', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {asset.filenameHint || asset.id}
                  </div>
                  <div style={{ color: '#94a3b8', fontSize: '0.75rem', marginTop: '0.2rem' }}>
                    {asset.mimeType} &bull; {(asset.byteSize / 1024).toFixed(1)} KB
                  </div>
                  <div style={{ marginTop: '0.5rem' }}>
                    <a
                      href={asset.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="crm-btn crm-btn-sm"
                      style={{ width: '100%', boxSizing: 'border-box', justifyContent: 'center' }}
                    >
                      Open Full Resolution &rarr;
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {assets.length === 0 && (
            <div style={{ textAlign: 'center', padding: '3rem', color: '#64748b' }}>
              No generated assets registered yet. When ChatGPT or operators upload media through the asset bridge, they will be listed here.
            </div>
          )}
        </div>
      )}

      {/* Create Prospect Modal */}
      {showCreateCompanyModal && (
        <div className="crm-modal-overlay">
          <div className="crm-modal">
            <div className="crm-modal-header">
              <h3 style={{ margin: 0 }}>Add New Prospect</h3>
              <button className="crm-btn" onClick={() => setShowCreateCompanyModal(false)}>✕</button>
            </div>
            <div className="crm-modal-body">
              <input
                type="text"
                className="crm-input"
                placeholder="Business / Company Name *"
                value={companyForm.name}
                onChange={e => setCompanyForm({ ...companyForm, name: e.target.value })}
              />
              <input
                type="text"
                className="crm-input"
                placeholder="Website / Domain (e.g. example.ro)"
                value={companyForm.domain}
                onChange={e => setCompanyForm({ ...companyForm, domain: e.target.value })}
              />
              <input
                type="text"
                className="crm-input"
                placeholder="Industry (e.g. Legal, Dental, Retail)"
                value={companyForm.industry}
                onChange={e => setCompanyForm({ ...companyForm, industry: e.target.value })}
              />
              <input
                type="email"
                className="crm-input"
                placeholder="Contact Email"
                value={companyForm.email}
                onChange={e => setCompanyForm({ ...companyForm, email: e.target.value })}
              />
              <input
                type="text"
                className="crm-input"
                placeholder="Phone"
                value={companyForm.phone}
                onChange={e => setCompanyForm({ ...companyForm, phone: e.target.value })}
              />
            </div>
            <div className="crm-modal-footer">
              <button className="crm-btn" onClick={() => setShowCreateCompanyModal(false)}>Cancel</button>
              <button className="crm-btn crm-btn-primary" onClick={handleCreateCompany}>Save Prospect</button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Import Modal */}
      {showImportModal && (
        <div className="crm-modal-overlay">
          <div className="crm-modal" style={{ maxWidth: '750px' }}>
            <div className="crm-modal-header">
              <h3 style={{ margin: 0 }}>Import Prospects from CSV</h3>
              <button className="crm-btn" onClick={() => setShowImportModal(false)}>✕</button>
            </div>
            <div className="crm-modal-body">
              <p style={{ fontSize: '0.85rem', color: '#94a3b8', margin: 0 }}>
                Paste CSV text with columns such as: <code>Name, Domain, Email, Phone, Industry, Contact</code>.<br/>
                Spreadsheet formula injection is automatically neutralized.
              </p>
              <textarea
                className="crm-input"
                rows={6}
                placeholder="Paste CSV rows here..."
                value={csvContent}
                onChange={e => setCsvContent(e.target.value)}
              />
              <button className="crm-btn" onClick={handlePreviewCsv}>
                Preview Import & Check Duplicates
              </button>

              {csvPreview && (
                <div style={{ marginTop: '1rem', background: '#0f172a', padding: '1rem', borderRadius: '0.375rem' }}>
                  <div style={{ display: 'flex', gap: '1rem', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
                    <span>Total Rows: <b>{csvPreview.totalRows}</b></span>
                    <span style={{ color: '#34d399' }}>Valid: <b>{csvPreview.validRows}</b></span>
                    <span style={{ color: '#fbbf24' }}>Duplicates: <b>{csvPreview.duplicateCount}</b></span>
                  </div>
                  <div style={{ maxHeight: '180px', overflowY: 'auto' }}>
                    <table className="crm-table" style={{ fontSize: '0.75rem' }}>
                      <thead>
                        <tr>
                          <th>Row</th>
                          <th>Company Name</th>
                          <th>Domain</th>
                          <th>Duplicate Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {csvPreview.rows.map((r: any) => (
                          <tr key={r.rowIndex}>
                            <td>{r.rowIndex}</td>
                            <td>{r.name}</td>
                            <td>{r.domain || '-'}</td>
                            <td>
                              {r.isDuplicate ? (
                                <span className="crm-pill crm-pill-amber">{r.duplicateReason}</span>
                              ) : (
                                <span className="crm-pill crm-pill-green">Ready</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
            <div className="crm-modal-footer">
              <button className="crm-btn" onClick={() => setShowImportModal(false)}>Cancel</button>
              {csvPreview && (
                <>
                  <button className="crm-btn" onClick={() => handleExecuteCsv(false)}>
                    Import All (Include Duplicates)
                  </button>
                  <button className="crm-btn crm-btn-primary" onClick={() => handleExecuteCsv(true)}>
                    Import (Skip Duplicates)
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* New Deal Modal */}
      {showNewDealModal && (
        <div className="crm-modal-overlay">
          <div className="crm-modal">
            <div className="crm-modal-header">
              <h3 style={{ margin: 0 }}>Create Opportunity Deal</h3>
              <button className="crm-btn" onClick={() => setShowNewDealModal(false)}>✕</button>
            </div>
            <div className="crm-modal-body">
              <input
                type="text"
                className="crm-input"
                placeholder="Deal Title (e.g. Website Redesign Retainer)"
                value={dealForm.title}
                onChange={e => setDealForm({ ...dealForm, title: e.target.value })}
              />
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  type="number"
                  className="crm-input"
                  placeholder="Amount"
                  style={{ flex: 1 }}
                  value={dealForm.amount}
                  onChange={e => setDealForm({ ...dealForm, amount: parseFloat(e.target.value) || 0 })}
                />
                <select
                  className="crm-input"
                  value={dealForm.currency}
                  onChange={e => setDealForm({ ...dealForm, currency: e.target.value })}
                >
                  <option value="EUR">EUR</option>
                  <option value="RON">RON</option>
                  <option value="USD">USD</option>
                </select>
              </div>
              <select
                className="crm-input"
                value={dealForm.stageId}
                onChange={e => setDealForm({ ...dealForm, stageId: e.target.value })}
              >
                {pipeline?.stages.map(st => (
                  <option key={st.id} value={st.id}>{st.name} ({st.probability}%)</option>
                ))}
              </select>
            </div>
            <div className="crm-modal-footer">
              <button className="crm-btn" onClick={() => setShowNewDealModal(false)}>Cancel</button>
              <button className="crm-btn crm-btn-primary" onClick={handleCreateDeal}>Save Deal</button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Modal */}
      {showMergeModal && selectedCompany && (
        <div className="crm-modal-overlay">
          <div className="crm-modal">
            <div className="crm-modal-header">
              <h3 style={{ margin: 0 }}>Merge Company Record</h3>
              <button className="crm-btn" onClick={() => setShowMergeModal(false)}>✕</button>
            </div>
            <div className="crm-modal-body">
              <p style={{ fontSize: '0.85rem', color: '#cbd5e1', margin: 0 }}>
                Merge source <b>{selectedCompany.name}</b> (v{selectedCompany.version}) into another master company. All contacts, deals, tasks, signals and platform links will be re-parented.
              </p>
              <label style={{ fontSize: '0.8rem', color: '#94a3b8' }}>Select Target Company:</label>
              <select
                className="crm-input"
                value={mergeTargetId}
                onChange={e => setMergeTargetId(e.target.value)}
              >
                <option value="">-- Choose target company --</option>
                {companies.filter(c => c.id !== selectedCompany.id).map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.domain || 'no domain'})</option>
                ))}
              </select>
            </div>
            <div className="crm-modal-footer">
              <button className="crm-btn" onClick={() => setShowMergeModal(false)}>Cancel</button>
              <button className="crm-btn crm-btn-primary" disabled={!mergeTargetId} onClick={handleMerge}>
                Execute Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
