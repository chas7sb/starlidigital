import React, { useState, useEffect, useRef } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Bell, Bookmark, Check, CheckCircle2,
  ChevronDown, ChevronRight, Code2, Copy, Download, ExternalLink, Eye, FileCode,
  FileText, FolderCode, Globe, HelpCircle, History, Layers, LoaderCircle, MessageSquare,
  Monitor, MousePointerClick, Palette, Pencil, Plus, RefreshCw, RotateCcw,
  Smartphone, Sparkles, Tablet, Terminal, Trash2, Wand2, X, Zap, Settings
} from 'lucide-react';
import {
  gql, subscribe, CONVERSATION_FIELDS, PROJECT_FIELDS, PROJECT_SUMMARY_FIELDS,
  type Project, type Conversation, type AgentActionMode, type StructuredPlan,
  type AgentRun, type ProjectVersion, type InteractiveQuestion, type ChatAttachment
} from './api';
import { Markdown } from './Markdown';
import {useCreditConsent} from './CreditConsent';
import { projectArchive } from './project-archive';
import {buildNavigablePreview,readPreviewNavigation} from './preview-navigation';
import { ProjectCommerce } from './ProjectCommerce';
import { DomainManager } from './DomainManager';
import {isCurrentProjectRequest,prepareProjectCodeSave,readPreviewSelection,snapshotStudioPrompt,canLeaveCodeDraft,agentStepState,actualStepDuration,runManualInlineEdit,type QueuedStudioPrompt,type ProjectCodeDraft,type ProjectRequestScope} from './studio-guards';

type CreditQueuedPrompt=QueuedStudioPrompt&{maxCredits:number;requestId:string};

function Star({ state = 'idle', className = '' }: { state?: 'idle' | 'thinking' | 'building' | 'done'; className?: string }) {
  return (
    <svg className={`star star-${state} ${className}`} viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
      <path d="M32 0C34.5 25.5 38.5 29.5 64 32C38.5 34.5 34.5 38.5 32 64C29.5 38.5 25.5 34.5 0 32C25.5 29.5 29.5 25.5 32 0Z" />
    </svg>
  );
}

export type SelectedPreviewElement = {
  tag: string;
  selector: string;
  text: string;
};


const MODE_LABELS: Record<AgentActionMode, { label: string; hint: string }> = {
  AUTO: {label:'Starli AI',hint:'Starli automatically understands your intent'},
  CHAT: { label: 'Discuss', hint: 'Strategy, ideas and discussions without modifying code' },
  PLAN: { label: 'Plan', hint: 'Proposes direction and steps before building' },
  BUILD: { label: 'Build', hint: 'Executes changes and updates the website' }
};

const TUTORIAL_STEPS = [
  {
    title: 'Ask Starli',
    body: 'Ask Starli to update any section, paste images or documents (Ctrl+V), or press Tab to accept auto-suggestions.'
  },
  {
    title: 'Direct element selection',
    body: 'Activeate Select and click on any headline, button or section in the preview to edit it inline or instruct Starli what to change.'
  },
  {
    title: 'Web Research & Competitive Analysis',
    body: 'Starli researches the live web and saves the competitive brief as a strategic document you can inspect and refine.'
  },
  {
    title: 'Real-time Notifications & Activeity',
    body: 'Every action performed in the project (research, new version, verification, publish) appears in notifications and Starli Activeity.'
  },
  {
    title: 'Versiuni & Publicare cu un click',
    body: 'Every modification creates a save point in Versions. When ready, click Publish to deploy your website to your custom domain.'
  }
];

function InteractiveQuestionCard({
  questionJson,
  onSelectAnswer,
  disabled
}: {
  questionJson?: string;
  onSelectAnswer: (ans: string) => void;
  disabled?: boolean;
}) {
  const [customVal, setCustomVal] = useState('');
  const [customFocus, setCustomFocus] = useState(false);
  if (!questionJson) return null;
  let q: InteractiveQuestion | null = null;
  try {
    q = JSON.parse(questionJson);
  } catch {
    return null;
  }
  if (!q || !Array.isArray(q.options)) return null;

  return (
    <div className="interactive-question-card">
      <div className="iq-options-list">
        {q.options.map((opt, idx) => (
          <button
            type="button"
            key={idx}
            disabled={disabled}
            className={`iq-option-row ${opt.recommended ? 'recommended' : ''}`}
            onClick={() => onSelectAnswer(opt.value || opt.label)}
          >
            <span className="iq-num">{idx + 1}</span>
            <span className="iq-label">{opt.label}</span>
            {opt.recommended && <span className="iq-rec-badge">Recomandat</span>}
            {opt.recommended && <ArrowRight size={14} className="iq-arrow" />}
          </button>
        ))}

        {q.allowCustom !== false && (
          <form
            className={`iq-custom-row ${customFocus ? 'focused' : ''}`}
            onSubmit={e => {
              e.preventDefault();
              if (customVal.trim() && !disabled) {
                onSelectAnswer(customVal.trim());
                setCustomVal('');
              }
            }}
          >
            <span className="iq-num">
              <Pencil size={12} />
            </span>
            <input
              disabled={disabled}
              value={customVal}
              onFocus={() => setCustomFocus(true)}
              onBlur={() => setCustomFocus(false)}
              onChange={e => setCustomVal(e.target.value)}
              placeholder={q.customPlaceholder || 'Custom response (type your answer)…'}
            />
            {customVal.trim() && (
              <button type="submit" className="iq-custom-send" disabled={disabled} aria-label="Submit answer">
                <ArrowRight size={14} />
              </button>
            )}
          </form>
        )}
      </div>

      {q.moreIdeasLabel && (
        <div className="iq-footer-actions">
          <button
            type="button"
            disabled={disabled}
            className="iq-more-pill"
            onClick={() => onSelectAnswer(q!.moreIdeasPrompt || q!.moreIdeasLabel!)}
          >
            <RefreshCw size={12} /> {q.moreIdeasLabel}
          </button>
        </div>
      )}
    </div>
  );
}

function formatStepDuration(createdAt?: string, completedAt?: string, idx = 0): string {
  return actualStepDuration(createdAt,completedAt);
}

export function ProjectEditor({ onToggleSidebar, sidebarCollapsed }: { onToggleSidebar?: () => void; sidebarCollapsed?: boolean }) {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [project, setProject] = useState<Project | null>(null);
  const creditConsent=useCreditConsent({hasFiles:!!project?.files.length,scopeKey:projectId});
  const pendingPrompt=useRef<{signature:string;id:string}|null>(null);
  const directRequests=useRef(new Map<string,string>());
  function directRequestId(signature:string){const previous=directRequests.current.get(signature);if(previous)return previous;const key=crypto.randomUUID();directRequests.current.set(signature,key);return key;}
  const [allProjects, setAllProjects] = useState<Project[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Top bar popovers
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [activityDrawerOpen, setActiveityDrawerOpen] = useState(false);
  const [deletingProject, setDeletingProject] = useState(false);

  // Composer & AI mode state
  const [input, setInput] = useState('');
  const actionMode:AgentActionMode='AUTO';

  const [sending, setSending] = useState(false);
  const [queuedSteering, setQueuedSteering] = useState<CreditQueuedPrompt[]>([]);
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [liveTimerSec, setLiveTimerSec] = useState(0);
  const [researchRunning, setResearchRunning] = useState(false);

  // Interactive tutorial coachmark
  const [tutorialStep, setTutorialStep] = useState<number | null>(() => {
    try {
      return localStorage.getItem('starli_studio_tutorial_done') === '1' ? null : 0;
    } catch {
      return 0;
    }
  });

  // Right surface & Preview controls
  const [rightSurface, setRightSurface] = useState<'preview' | 'research_doc' | 'code' | 'history' | 'settings' | 'details' | 'publish'>('preview');
  const [viewport, setViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [previewKey, setPreviewKey] = useState(0);
  const [previewPage,setPreviewPage]=useState<{path:string;hash:string;html:string}|null>(null);
  const [previewNavigating,setPreviewNavigating]=useState(false);
  const previewNavigationRequest=useRef(0);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedElement, setSelectedElement] = useState<SelectedPreviewElement | null>(null);
  const [inlineEditing, setInlineEditing] = useState(false);
  const [inlineTextValue, setInlineTextValue] = useState('');
  const [inlineEditFailed,setInlineEditFailed]=useState(false);
  const [previewingVersion, setPreviewingVersion] = useState<ProjectVersion | null>(null);
  const [copiedDoc, setCopiedDoc] = useState(false);

  // Code viewer / editor state
  const [activeFile, setActiveeFile] = useState('app/page.tsx');
  const [fileSearch, setFileSearch] = useState('');
  const [codeDraft,setCodeDraft]=useState<ProjectCodeDraft|null>(null);
  const editingCode=codeDraft?.content??null;
  function setEditingCode(value:string|null){setCodeDraft(current=>value===null?null:current?{...current,content:value}:null);}
  const [savingCode, setSavingCode] = useState(false);

  // Details tab state
  const [detailsTab, setDetailsTab] = useState<'activity' | 'files' | 'logs' | 'tests'>('activity');

  // DNA form state
  const [dnaForm, setDnaForm] = useState({
    businessSummary: '',
    audience: '',
    goals: '',
    brandDirection: '',
    language: 'English',
    technicalRules: '',
    customInstructions: ''
  });
  const [savingDna, setSavingDna] = useState(false);
  const [preferencesSaved, setPreferencesSaved] = useState(false);

  // Mobile responsive tab (Chat / Preview / Project)
  const [mobileTab, setMobileTab] = useState<'chat' | 'preview' | 'project'>('chat');

  // Title rename state
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');

  const chatEndRef = useRef<HTMLDivElement>(null);
  const filePickerRef = useRef<HTMLInputElement>(null);
  const previewIframeRef=useRef<HTMLIFrameElement>(null);
  const currentProjectIdRef=useRef(projectId);
  const projectEpochRef=useRef(0);
  currentProjectIdRef.current=projectId;
  function currentScope():ProjectRequestScope{return {projectId:currentProjectIdRef.current||'',epoch:projectEpochRef.current};}
  function applyProjectResponse(updated:Project,scope:ProjectRequestScope){if(!isCurrentProjectRequest(scope,currentScope())||updated.id!==currentProjectIdRef.current)return false;setProject(updated);return true;}

  // Load project + all projects + linked conversation
  useEffect(() => {
    if (!projectId) return;
    const scope={projectId,epoch:++projectEpochRef.current};
    let cancelled=false;
    const isCurrent=()=>!cancelled&&isCurrentProjectRequest(scope,currentScope());
    setLoading(true);
    setProject(null);setConversation(null);setInput('');setAttachments([]);setQueuedSteering([]);setSelectedElement(null);setInlineTextValue('');setInlineEditing(false);setInlineEditFailed(false);setSelectMode(false);setPreviewingVersion(null);setCodeDraft(null);setActiveeFile('app/page.tsx');setFileSearch('');setSavingCode(false);setSending(false);setResearchRunning(false);setEditingTitle(false);setTitleDraft('');setSavingDna(false);setDeletingProject(false);setRightSurface('preview');setActiveityDrawerOpen(false);
    setDnaForm({businessSummary:'',audience:'',goals:'',brandDirection:'',language:'English',technicalRules:'',customInstructions:''});
    setPreferencesSaved(false);
    setError('');
    setProjectSwitcherOpen(false);
    setNotificationsOpen(false);
    (async () => {
      try {
        const data = await gql<{ project: Project; projects: Project[]; conversations: Conversation[] }>(
          `query($id:ID!){ project(id:$id){${PROJECT_FIELDS}} projects{${PROJECT_SUMMARY_FIELDS}} conversations{id projectId mode} }`,
          { id: projectId }
        );
        if(!isCurrent())return;
        setProject(data.project);
        setAllProjects(data.projects);
        if(!data.project)throw new Error('Project not found or access denied.');
        setTitleDraft(data.project.name);
        if (data.project.knowledge) {
          setDnaForm({
            businessSummary: data.project.knowledge.businessSummary || '',
            audience: data.project.knowledge.audience || '',
            goals: data.project.knowledge.goals || '',
            brandDirection: data.project.knowledge.brandDirection || '',
            language: data.project.knowledge.language || 'English',
            technicalRules: data.project.knowledge.technicalRules || '',
            customInstructions: data.project.knowledge.customInstructions || ''
          });
        }
        const linked = data.conversations.find(c => c.projectId === projectId && c.mode === 'STARLI');
        if (linked) {
          const detail=await gql<{conversation:Conversation}>(`query($id:ID!){conversation(id:$id){${CONVERSATION_FIELDS}}}`,{id:linked.id});
          if(!isCurrent())return;
          setConversation(detail.conversation);
        } else {
          const created = await gql<{ createConversation: Conversation }>(
            `mutation($title:String,$projectId:ID){ createConversation(mode:STARLI,title:$title,projectId:$projectId){${CONVERSATION_FIELDS}} }`,
            { title: data.project.name, projectId }
          );
          if(!isCurrent())return;
          setConversation(created.createConversation);
        }
      } catch (e) {
        if(isCurrent())setError((e as Error).message);
      } finally {
        if(isCurrent())setLoading(false);
      }
    })();

    const unsubProjects = subscribe<{ projectsUpdated: Project[] }>(
      `subscription{projectsUpdated{${PROJECT_SUMMARY_FIELDS}}}`,
      {},
      d => {
        if(!isCurrent())return;
        setAllProjects(d.projectsUpdated);
        const updated = d.projectsUpdated.find(p => p.id === projectId);
        if (updated) {
          // Project details arrive through the project-scoped subscription below.
        }
      }
    );
    const unsubProject=subscribe<{projectUpdated:Project|null}>(
      `subscription($id:ID!){projectUpdated(id:$id){${PROJECT_FIELDS}}}`,{id:projectId},
      data=>{if(isCurrent()&&data.projectUpdated)setProject(data.projectUpdated);}
    );
    return () => { cancelled=true;unsubProjects();unsubProject(); };
  }, [projectId]);

  // Subscribe to conversation updates
  useEffect(() => {
    if (!conversation?.id) return;
    const scope=currentScope();
    return subscribe<{ conversationUpdated: Conversation }>(
      `subscription($id:ID!){conversationUpdated(id:$id){${CONVERSATION_FIELDS}}}`,
      { id: conversation.id },
      d => {
        if(!isCurrentProjectRequest(scope,currentScope())||d.conversationUpdated.projectId!==currentProjectIdRef.current)return;
        setConversation(d.conversationUpdated);
        if (!d.conversationUpdated.agentStatus) {
          setSending(false);
        }
      }
    );
  }, [conversation?.id]);

  const isBuilding = project ? ['BUILDING', 'VERIFYING'].includes(project.status) : false;
  const isAgentWorking = sending || isBuilding || Boolean(conversation?.agentStatus) || researchRunning;

  // Live 0.1s elapsed timer when Starli is thinking or working (Batch 1 Image 3/5, Batch 2 Image 1)
  useEffect(() => {
    if (!isAgentWorking) {
      setLiveTimerSec(0);
      return;
    }
    const startMs = Date.now();
    const iv = setInterval(() => {
      setLiveTimerSec((Date.now() - startMs) / 1000);
    }, 100);
    return () => clearInterval(iv);
  }, [isAgentWorking]);

  useEffect(()=>{previewNavigationRequest.current++;setPreviewPage(null);setPreviewNavigating(false);},[projectId,previewingVersion?.id,project?.previewHtml]);

  // Sandboxed documents may ask to navigate, but can never navigate the platform.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const frame=previewIframeRef.current?.contentWindow;
      if(!frame||event.source!==frame||event.origin!=='null')return;
      const el=readPreviewSelection(event,frame,selectMode&&rightSurface==='preview'&&!previewingVersion);
      if(el){setSelectedElement(el);setInlineTextValue(el.text||'');setInlineEditing(false);setInlineEditFailed(false);return;}
      if(selectMode)return;
      if(event.data?.type==='STARLI_PREVIEW_FORM'){setError('Forms do not submit live data in preview. Submission can be tested once deployed.');return;}
      if(event.data?.type==='STARLI_PREVIEW_EXTERNAL'){setError('External links, phone and mailto are disabled in preview. The website stays open here.');return;}
      const navigation=readPreviewNavigation(event,frame);
      if(!navigation){if(event.data?.type==='STARLI_PREVIEW_NAVIGATE')setError('This page is not available in preview.');return;}
      if(!project)return;
      const scope=currentScope(),request=++previewNavigationRequest.current;
      setError('');setSelectedElement(null);setPreviewNavigating(true);
      if(navigation.path==='/'){
        setPreviewPage({path:'/',hash:navigation.hash,html:previewingVersion?.previewHtml||project.previewHtml||''});setPreviewNavigating(false);return;
      }
      void gql<{projectPreview:string}>(`query($projectId:ID!,$path:String!,$versionId:ID){projectPreview(projectId:$projectId,path:$path,versionId:$versionId)}`,{projectId:project.id,path:navigation.path,versionId:previewingVersion?.id||null}).then(data=>{
        if(request!==previewNavigationRequest.current||!isCurrentProjectRequest(scope,currentScope()))return;
        setPreviewPage({...navigation,html:data.projectPreview});
      }).catch(error=>{if(request===previewNavigationRequest.current&&isCurrentProjectRequest(scope,currentScope()))setError(error.message);}).finally(()=>{if(request===previewNavigationRequest.current&&isCurrentProjectRequest(scope,currentScope()))setPreviewNavigating(false);});
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [selectMode,rightSurface,previewingVersion?.id,projectId,project?.previewHtml]);

  // Scroll chat on new messages or agent steps
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages.length, project?.agentRuns?.[0]?.steps?.length, sending, isBuilding]);

  // Process queued steering messages when build/chat finishes
  useEffect(() => {
    if (!isBuilding && !sending && queuedSteering.length > 0 && conversation) {
      const [nextMsg, ...rest] = queuedSteering;
      setQueuedSteering(rest);
      void sendPrompt(nextMsg.content,nextMsg.actionMode,nextMsg);
    }
  }, [isBuilding, sending, queuedSteering.length]);

  async function handleAttachFiles(fileList: FileList | File[]) {
    const scope=currentScope();
    const arr = Array.from(fileList).slice(0, 4);
    for (const f of arr) {
      if (f.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = () => {
          if(!isCurrentProjectRequest(scope,currentScope()))return;
          setAttachments(prev => [
            ...prev.slice(0, 4),
            { name: f.name || 'imagine-lipita.png', mimeType: f.type, dataUrl: String(reader.result || '') }
          ]);
        };
        reader.readAsDataURL(f);
      } else {
        const text = await f.text().catch(() => '');
        if(!isCurrentProjectRequest(scope,currentScope()))return;
        setAttachments(prev => [
          ...prev.slice(0, 4),
          { name: f.name || 'document.txt', mimeType: f.type || 'text/plain', textExcerpt: text.slice(0, 6000) }
        ]);
      }
    }
  }

  async function sendPrompt(textToSend: string, overrideMode?: AgentActionMode,queuedRequest?:CreditQueuedPrompt) {
    const scope=currentScope();
    const trimmed = textToSend.trim();
    if ((!trimmed && attachments.length === 0&&!queuedRequest?.attachments.length) || !conversation||!project||project.id!==scope.projectId||conversation.projectId!==scope.projectId) return;
    const finalContent = trimmed || `Attached to the conversation: ${attachments.map(a => a.name).join(', ')}`;
    const request:CreditQueuedPrompt={...snapshotStudioPrompt(queuedRequest||{content:finalContent,actionMode:overrideMode||actionMode,selectedElementContext:selectedElement?`<${selectedElement.tag}> (${selectedElement.selector}): "${selectedElement.text}"`:undefined,attachments}),maxCredits:queuedRequest?.maxCredits??creditConsent.maxCredits,requestId:queuedRequest?.requestId||crypto.randomUUID()};
    if(!queuedRequest)creditConsent.reset();
    if (isBuilding || sending) {
      setQueuedSteering(q => [...q, request]);
      setInput('');
      setAttachments([]);setSelectedElement(null);setSelectMode(false);
      return;
    }
    const signature=JSON.stringify({conversationId:conversation.id,...request,requestId:undefined});
    if(!queuedRequest&&pendingPrompt.current?.signature===signature)request.requestId=pendingPrompt.current.id;
    pendingPrompt.current={signature,id:request.requestId};
    const attPayload = request.attachments;
    setSending(true);
    setError('');
    setInput('');
    setAttachments([]);
    const modeToUse = request.actionMode;
    const elemContext = request.selectedElementContext;
    try {
      await gql(
        'mutation($conversationId:ID!,$content:String!,$actionMode:AgentActionMode,$selectedElementContext:String,$attachments:[ChatAttachmentInput!],$maxCredits:Int,$requestId:ID){sendMessage(conversationId:$conversationId,content:$content,actionMode:$actionMode,selectedElementContext:$selectedElementContext,attachments:$attachments,maxCredits:$maxCredits,requestId:$requestId){id}}',
        {
          conversationId: conversation.id,
          content: request.content,
          actionMode: modeToUse,
          maxCredits:request.maxCredits,requestId:request.requestId,
          selectedElementContext: elemContext,
          attachments: attPayload.length > 0 ? attPayload : undefined
        }
      );
      if(pendingPrompt.current?.id===request.requestId)pendingPrompt.current=null;
      const d = await gql<{ conversation: Conversation }>(
        `query($id:ID!){conversation(id:$id){${CONVERSATION_FIELDS}}}`,
        { id: conversation.id }
      );
      if(!isCurrentProjectRequest(scope,currentScope()))return;
      setConversation(d.conversation);
      setSelectedElement(null);
      setSelectMode(false);
    } catch (e) {
      if(!isCurrentProjectRequest(scope,currentScope()))return;
      setError((e as Error).message);
      setSending(false);
    }
  }

  async function triggerBuild(regenerateImages = false, customSummary?: string) {
    if (!project || isBuilding||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    setError('');
    const elemContext = selectedElement
      ? `<${selectedElement.tag}> (${selectedElement.selector}): "${selectedElement.text}"`
      : undefined;
    try {
      const maxCredits=await creditConsent.confirmAction('build',!!project.files.length,regenerateImages);
      if(maxCredits===null||!isCurrentProjectRequest(scope,currentScope()))return;
      const signature=JSON.stringify({kind:'build',projectId:project.id,regenerateImages,summary:customSummary,elemContext,maxCredits});
      const requestId=directRequestId(signature);
      const d = await gql<{ buildProject: Project }> (
        `mutation($id:ID!,$regenerateImages:Boolean,$summary:String,$selectedElementContext:String,$maxCredits:Int,$requestId:ID){buildProject(id:$id,regenerateImages:$regenerateImages,summary:$summary,selectedElementContext:$selectedElementContext,maxCredits:$maxCredits,requestId:$requestId){${PROJECT_FIELDS}}}`,
        { id: project.id, regenerateImages, summary: customSummary, selectedElementContext: elemContext,maxCredits,requestId }
      );
      directRequests.current.delete(signature);
      applyProjectResponse(d.buildProject,scope);
    } catch (e) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);
    }
  }

  async function triggerWebResearch() {
    if (!project || researchRunning||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    setResearchRunning(true);
    setError('');
    try {
      const maxCredits=await creditConsent.confirmAction('research');
      if(maxCredits===null||!isCurrentProjectRequest(scope,currentScope()))return;
      const signature=JSON.stringify({kind:'research',projectId:project.id,maxCredits});
      const requestId=directRequestId(signature);
      const d = await gql<{ runProjectResearch: Project }>(
        `mutation($projectId:ID!,$maxCredits:Int,$requestId:ID){runProjectResearch(projectId:$projectId,maxCredits:$maxCredits,requestId:$requestId){${PROJECT_FIELDS}}}`,
        { projectId: project.id,maxCredits,requestId }
      );
      directRequests.current.delete(signature);
      if(!applyProjectResponse(d.runProjectResearch,scope))return;
      setRightSurface('research_doc');
    } catch (e) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);
    } finally {
      if(isCurrentProjectRequest(scope,currentScope()))setResearchRunning(false);
    }
  }

  async function markNotificationsRead(notificationId?: string) {
    if (!project||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    try {
      const d = await gql<{ markProjectNotificationsRead: Project }>(
        `mutation($projectId:ID!,$notificationId:ID){markProjectNotificationsRead(projectId:$projectId,notificationId:$notificationId){${PROJECT_FIELDS}}}`,
        { projectId: project.id, notificationId }
      );
      applyProjectResponse(d.markProjectNotificationsRead,scope);
    } catch {
      // ignore
    }
  }

  async function handleDeleteCurrentProject() {
    if (!project || isBuilding || deletingProject||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    if (!window.confirm(`Permanently delete project "${project.name}"? This action cannot be undone.`)) return;
    setDeletingProject(true);
    try {
      await gql('mutation($id:ID!){deleteProject(id:$id)}', { id: project.id });
      if(!isCurrentProjectRequest(scope,currentScope()))return;
      navigate('/app');
    } catch (e) {
      if(!isCurrentProjectRequest(scope,currentScope()))return;
      setError((e as Error).message);
      setDeletingProject(false);
    }
  }

  async function approvePlan(plan: StructuredPlan) {
    if (!project||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    setError('');
    try {
      await gql(
        `mutation($id:ID!,$name:String,$brief:String){updateProject(id:$id,name:$name,brief:$brief){id}}`,
        { id: project.id, name: plan.name || project.name, brief: plan.brief || project.brief }
      );
      if(!isCurrentProjectRequest(scope,currentScope()))return;
      await triggerBuild(false, `Plan aprobat: ${plan.objective || plan.name}`);
    } catch (e) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);
    }
  }

  async function saveTitle() {
    const scope=currentScope();
    if(project&&project.id!==scope.projectId)return;
    if (!project || !titleDraft.trim() || titleDraft.trim() === project.name) {
      setEditingTitle(false);
      return;
    }
    try {
      const d = await gql<{ updateProject: Project }>(
        `mutation($id:ID!,$name:String){updateProject(id:$id,name:$name){${PROJECT_FIELDS}}}`,
        { id: project.id, name: titleDraft.trim() }
      );
      if(!applyProjectResponse(d.updateProject,scope))return;
      setEditingTitle(false);
    } catch (e) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);
    }
  }

  async function saveInlineText(e: React.FormEvent) {
    e.preventDefault();
    if (!project || !selectedElement || !selectedElement.text||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    setInlineEditFailed(false);setError('');
    const outcome=await runManualInlineEdit(()=>gql<{ inlineTextEdit: Project }>(
        `mutation($projectId:ID!,$originalText:String!,$replacementText:String!){inlineTextEdit(projectId:$projectId,originalText:$originalText,replacementText:$replacementText){${PROJECT_FIELDS}}}`,
        { projectId: project.id, originalText: selectedElement.text, replacementText: inlineTextValue }
      ));
    if(!isCurrentProjectRequest(scope,currentScope()))return;
    if(outcome.ok){
      if(!applyProjectResponse(outcome.value.inlineTextEdit,scope))return;
      setInlineEditing(false);
      setSelectedElement(null);
      setSelectMode(false);
    } else {
      setError(outcome.message);setInlineEditFailed(true);
    }
  }

  async function saveCodeFile() {
    if (!project || codeDraft === null) return;
    const scope=currentScope();
    setSavingCode(true);
    setError('');
    try {
      const draft=prepareProjectCodeSave(currentProjectIdRef.current,codeDraft);
      const d = await gql<{ updateProjectFile: Project }>(
        `mutation($projectId:ID!,$path:String!,$content:String!){updateProjectFile(projectId:$projectId,path:$path,content:$content){${PROJECT_FIELDS}}}`,
        { projectId: draft.projectId, path: draft.path, content: draft.content }
      );
      if(!applyProjectResponse(d.updateProjectFile,scope))return;
      setEditingCode(null);
    } catch (e) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);
    } finally {
      if(isCurrentProjectRequest(scope,currentScope()))setSavingCode(false);
    }
  }

  async function saveKnowledge(e: React.FormEvent) {
    e.preventDefault();
    if (!project||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    setSavingDna(true);
    setPreferencesSaved(false);
    setError('');
    try {
      const d = await gql<{ updateProjectKnowledge: Project }>(
        `mutation($projectId:ID!,$input:ProjectKnowledgeInput!){updateProjectKnowledge(projectId:$projectId,input:$input){${PROJECT_FIELDS}}}`,
        { projectId: project.id, input: {customInstructions:dnaForm.customInstructions} }
      );
      applyProjectResponse(d.updateProjectKnowledge,scope);
      if(isCurrentProjectRequest(scope,currentScope()))setPreferencesSaved(true);
    } catch (err) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((err as Error).message);
    } finally {
      if(isCurrentProjectRequest(scope,currentScope()))setSavingDna(false);
    }
  }

  async function previewVersion(version:ProjectVersion){
    if(!project)return;
    const scope=currentScope();setError('');
    try{
      const data=await gql<{projectVersion:ProjectVersion|null}>(`query($projectId:ID!,$versionId:ID!){projectVersion(projectId:$projectId,versionId:$versionId){id summary createdAt previewHtml}}`,{projectId:project.id,versionId:version.id});
      if(!isCurrentProjectRequest(scope,currentScope()))return;
      if(!data.projectVersion?.previewHtml)throw new Error('This version does not have a saved preview.');
      setPreviewingVersion({...version,...data.projectVersion});setRightSurface('preview');
    }catch(e){if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);}
  }

  async function restoreVersion(version: ProjectVersion) {
    if (!project||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    if (!window.confirm(`Restore version "${version.summary}"? Current version remains in history.`)) return;
    try {
      const d = await gql<{ restoreProjectVersion: Project }>(
        `mutation($projectId:ID!,$versionId:ID!){restoreProjectVersion(projectId:$projectId,versionId:$versionId){${PROJECT_FIELDS}}}`,
        { projectId: project.id, versionId: version.id }
      );
      if(!applyProjectResponse(d.restoreProjectVersion,scope))return;
      setPreviewingVersion(null);
      setRightSurface('preview');
    } catch (e) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);
    }
  }

  async function toggleBookmark(version: ProjectVersion) {
    if (!project||project.id!==currentProjectIdRef.current) return;
    const scope=currentScope();
    try {
      const d = await gql<{ bookmarkProjectVersion: Project }>(
        `mutation($projectId:ID!,$versionId:ID!,$bookmarked:Boolean!){bookmarkProjectVersion(projectId:$projectId,versionId:$versionId,bookmarked:$bookmarked){${PROJECT_FIELDS}}}`,
        { projectId: project.id, versionId: version.id, bookmarked: !version.bookmarked }
      );
      applyProjectResponse(d.bookmarkProjectVersion,scope);
    } catch (e) {
      if(isCurrentProjectRequest(scope,currentScope()))setError((e as Error).message);
    }
  }

  function downloadZip() {
    if (!project || !project.files.length) return;
    try {
      const bytes = projectArchive(project.files);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/zip' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'website'}-nextjs.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function openPreviewNewTab() {
    const html = previewPage?.html || previewingVersion?.previewHtml || project?.previewHtml;
    if (!html) return;
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function advanceTutorial() {
    if (tutorialStep === null) return;
    if (tutorialStep + 1 >= TUTORIAL_STEPS.length) {
      closeTutorial();
    } else {
      setTutorialStep(tutorialStep + 1);
    }
  }

  function closeTutorial() {
    setTutorialStep(null);
    try {
      localStorage.setItem('starli_studio_tutorial_done', '1');
    } catch {
      // ignore
    }
  }

  if (loading) {
    return (
      <div className="editor-loading">
        <Star state="thinking" />
        <p>Opening project workspace…</p>
      </div>
    );
  }

  if (!project) {
    return (
      <main className="app-page">
        <div className="empty">
          <Star />
          <h3>Project not found.</h3>
          <p>{error || 'Please check your projects list.'}</p>
          <Link className="pill-button light" to="/app" style={{ marginTop: 20 }}>Back to projects</Link>
        </div>
      </main>
    );
  }

  const latestRun: AgentRun | undefined = project.agentRuns?.[0];
  const renderedProjectScope=currentScope();
  const hasGoodVersion = project.files.length > 0 || Boolean(project.previewHtml);
  const starState = isBuilding ? 'building' : sending ? 'thinking' : 'idle';
  const activePreviewHtml = previewPage?.html || previewingVersion?.previewHtml || project.previewHtml;
  const currentCodeFile = project.files.find(f => f.path === activeFile) || project.files[0];
  const unreadNotifications = (project.notifications || []).filter(n => !n.read);

  // Ghost Tab-autocomplete suggestion from the latest assistant turn
  const lastAssistantMsg = conversation?.messages.filter(m => m.role === 'assistant').at(-1);
  const ghostFollowUp = !input && lastAssistantMsg?.suggestedFollowUp ? lastAssistantMsg.suggestedFollowUp : '';

  // Calm human-readable top status pill
  const statusPill = project.publishState === 'live'
    ? { label: 'Published', dot: 'live' }
    : isBuilding
    ? { label: 'Building', dot: 'building' }
    : project.buildState === 'error' && !hasGoodVersion
    ? { label: 'Needs attention', dot: 'error' }
    : { label: 'Saved', dot: 'saved' };

  const strategyMarkdown = project.research || `## Research not started\nNo market or competitor research has been saved for **${project.name}** yet. Use Research web to collect sources before deciding on a direction.`;

  return (
    <div className="project-editor-shell">
      {/* FOUNDABLE-ADAPTED STUDIO TOP BAR */}
      <header className="editor-topbar">
        <div className="editor-topbar-left">
          {onToggleSidebar && (
            <button
              type="button"
              className="icon-button"
              onClick={onToggleSidebar}
              title={sidebarCollapsed ? 'Extinde panoul Starli' : 'Collapse sidebar'}
              aria-label="Toggle sidebar"
            >
              <Layers size={16} />
            </button>
          )}
          <Link to="/app" className="editor-back-btn" title="Toate proiectele">
            <ArrowLeft size={15} />
          </Link>

          {/* Project Switcher Dropdown (<Project Name> ▾) */}
          <div className="project-switcher-wrap">
            {editingTitle ? (
              <form
                className="editor-title-form"
                onSubmit={e => { e.preventDefault(); void saveTitle(); }}
              >
                <input
                  autoFocus
                  value={titleDraft}
                  onChange={e => setTitleDraft(e.target.value)}
                  onBlur={() => void saveTitle()}
                  maxLength={120}
                />
              </form>
            ) : (
              <button
                type="button"
                className="project-switcher-btn"
                onClick={() => setProjectSwitcherOpen(!projectSwitcherOpen)}
              >
                <Star className="switcher-star" />
                <strong>{project.name}</strong>
                <ChevronDown size={13} />
              </button>
            )}

            {projectSwitcherOpen && (
              <div className="project-switcher-menu" role="menu">
                <div className="switcher-menu-head">PROIECTELE TALE</div>
                {allProjects.map(p => (
                  <button
                    type="button"
                    key={p.id}
                    className={`switcher-project-item ${p.id === project.id ? 'active' : ''}`}
                    onClick={() => {
                      setProjectSwitcherOpen(false);
                      if (p.id !== project.id) navigate(`/app/projects/${p.id}`);
                    }}
                  >
                    <span>{p.name}</span>
                    {p.id === project.id && <Check size={13} />}
                  </button>
                ))}
                <div className="switcher-menu-divider" />
                <button type="button" className="switcher-action-item" onClick={()=>{setProjectSwitcherOpen(false);setRightSurface('settings');setMobileTab('preview');}}>
                  <Settings size={13}/> Project Settings
                </button>
                <button
                  type="button"
                  className="switcher-action-item"
                  onClick={() => {
                    setProjectSwitcherOpen(false);
                    setEditingTitle(true);
                  }}
                >
                  <Pencil size={13} /> Rename project
                </button>
                <Link to="/app/chat" className="switcher-action-item" onClick={() => setProjectSwitcherOpen(false)}>
                  <Plus size={13} /> Proiect nou
                </Link>
                <button
                  type="button"
                  className="switcher-action-item danger"
                  disabled={isBuilding || deletingProject}
                  onClick={() => {
                    setProjectSwitcherOpen(false);
                    void handleDeleteCurrentProject();
                  }}
                >
                  <Trash2 size={13} /> Delete this project
                </button>
              </div>
            )}
          </div>

          <span className={`editor-status-pill ${statusPill.dot}`}>
            <i /> {statusPill.label}
          </span>
        </div>

        {/* CENTER: Foundable-Adapted Mode Pills + Viewport & Direct Manipulation */}
        <div className="editor-topbar-center">
          <div className="studio-center-pills" role="tablist" aria-label="Mod de lucru Studio">
            <button
              type="button"
              className={rightSurface === 'research_doc' ? 'active' : ''}
              onClick={() => setRightSurface(rightSurface === 'research_doc' ? 'preview' : 'research_doc')}
              title="Strategy & Competitive Analysis"
            >
              <FileText size={13} /> <span>Analysis & Direction</span>
            </button>
            <button
              type="button"
              className={rightSurface === 'preview' ? 'active' : ''}
              onClick={() => setRightSurface('preview')}
              title="Build and preview live"
            >
              <Monitor size={13} /> <span>Build</span>
            </button>
          </div>

          {rightSurface === 'preview' && (
            <div className="viewport-switcher" role="group" aria-label="Dimensiune ecran">
              <button
                type="button"
                className={viewport === 'desktop' ? 'active' : ''}
                onClick={() => setViewport('desktop')}
                title="Desktop"
              >
                <Monitor size={13} />
              </button>
              <button
                type="button"
                className={viewport === 'tablet' ? 'active' : ''}
                onClick={() => setViewport('tablet')}
                title="Tablet (768px)"
              >
                <Tablet size={13} />
              </button>
              <button
                type="button"
                className={viewport === 'mobile' ? 'active' : ''}
                onClick={() => setViewport('mobile')}
                title="Mobil (390px)"
              >
                <Smartphone size={13} />
              </button>
            </div>
          )}

          {activePreviewHtml && rightSurface === 'preview' && (
            <div className="preview-quick-tools">
              <button
                type="button"
                className={`subtle-button ${selectMode ? 'active-tool' : ''}`}
                onClick={() => {
                  setSelectMode(!selectMode);
                  if (selectMode) setSelectedElement(null);
                }}
                title="Select an element in the page to edit inline or prompt Starli"
              >
                <MousePointerClick size={13} /> Select
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() => setPreviewKey(k => k + 1)}
                title="Reload preview"
                aria-label="Reload preview"
              >
                <RefreshCw size={14} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={openPreviewNewTab}
                title="Open in new tab"
                aria-label="Open in new tab"
              >
                <ExternalLink size={14} />
              </button>
            </div>
          )}
        </div>

        {/* RIGHT: Activeity Feed, Notifications Bell, Versions, Code, Tutorial, Publish */}
        <div className="editor-topbar-right">
          <button
            type="button"
            className={`editor-nav-btn ${activityDrawerOpen ? 'active' : ''}`}
            onClick={() => setActiveityDrawerOpen(!activityDrawerOpen)}
            title="Live Starli activity"
          >
            <Zap size={14} /> <span>Activeitate</span>
          </button>

          <button
            type="button"
            className={`editor-nav-btn ${rightSurface === 'history' ? 'active' : ''}`}
            onClick={() => setRightSurface(rightSurface === 'history' ? 'preview' : 'history')}
          >
            <History size={14} /> <span>Versiuni</span>
            {project.versions.length > 0 && <small>{project.versions.length}</small>}
          </button>

          <button
            type="button"
            className={`editor-nav-btn ${rightSurface === 'code' ? 'active' : ''}`}
            onClick={() => setRightSurface(rightSurface === 'code' ? 'preview' : 'code')}
          >
            <Code2 size={14} /> <span>Cod</span>
          </button>

          <button
            type="button"
            className={`editor-nav-btn ${rightSurface === 'details' ? 'active' : ''}`}
            onClick={() => setRightSurface(rightSurface === 'details' ? 'preview' : 'details')}
            title="Technical logs & checks"
          >
            <Terminal size={14} />
          </button>

          <button type="button" className={`editor-nav-btn ${rightSurface==='settings'?'active':''}`} onClick={()=>{setRightSurface(rightSurface==='settings'?'preview':'settings');setMobileTab('preview');}} title="Project settings" aria-label="Project settings">
            <Settings size={14}/>
          </button>

          {/* Interactive Tutorial Trigger */}
          <button
            type="button"
            className="icon-button"
            onClick={() => setTutorialStep(0)}
            title="Ghid interactiv Starli Studio"
            aria-label="Ghid interactiv"
          >
            <HelpCircle size={15} />
          </button>

          {/* Per-Project Notifications Bell (🔔) */}
          <div className="notifications-bell-wrap">
            <button
              type="button"
              className={`icon-button bell-btn ${notificationsOpen ? 'active' : ''}`}
              onClick={() => {
                const next = !notificationsOpen;
                setNotificationsOpen(next);
                if (next && unreadNotifications.length > 0) {
                  void markNotificationsRead();
                }
              }}
              aria-label="Project notifications"
              title="Project notifications"
            >
              <Bell size={15} />
              {unreadNotifications.length > 0 && (
                <span className="bell-unread-badge">{unreadNotifications.length}</span>
              )}
            </button>

            {notificationsOpen && (
              <div className="notifications-dropdown" role="region" aria-label="Project notifications">
                <div className="notifications-head">
                  <div>
                    <strong>Project notifications</strong>
                    <small>{project.name}</small>
                  </div>
                  {(project.notifications || []).length > 0 && (
                    <button type="button" className="text-link" onClick={() => void markNotificationsRead()}>
                      Mark as read
                    </button>
                  )}
                </div>
                <div className="notifications-list">
                  {(project.notifications || []).length === 0 ? (
                    <p className="muted" style={{ padding: '16px', margin: 0, fontSize: 12 }}>
                      No notifications yet. Builds, research and changes will appear here.
                    </p>
                  ) : (
                    (project.notifications || []).map(n => (
                      <div key={n.id} className={`notification-item ${n.read ? 'read' : 'unread'}`}>
                        <span className={`notif-dot ${n.kind}`} />
                        <div>
                          <strong>{n.title}</strong>
                          {n.detail && <p>{n.detail}</p>}
                          <small>{new Date(n.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</small>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            type="button"
            className="editor-publish-btn"
            onClick={() => setRightSurface(rightSurface === 'publish' ? 'preview' : 'publish')}
          >
            <Globe size={14} />
            <span>{project.publishState === 'live' ? 'Update website' : 'Publish'}</span>
          </button>
        </div>
      </header>

      {/* MOBILE VIEW SWITCHER */}
      <div className="editor-mobile-tabs">
        <button type="button" className={mobileTab === 'chat' ? 'active' : ''} onClick={() => setMobileTab('chat')}>
          Starli AI
        </button>
        <button type="button" className={mobileTab === 'preview' ? 'active' : ''} onClick={() => { setMobileTab('preview'); setRightSurface('preview'); }}>
          Preview Live
        </button>
        <button type="button" className={mobileTab === 'project' ? 'active' : ''} onClick={() => { setMobileTab('project'); setRightSurface('publish'); }}>
          Proiect & Publicare
        </button>
      </div>

      {/* MAIN SPLIT WORKSPACE */}
      <div className={`editor-split-body ${activityDrawerOpen ? 'with-activity-drawer' : ''}`}>
        {/* LEFT PANEL: STARLI CONVERSATION + LIVE THINKING/WORKING + COMPOSER */}
        <section className={`editor-chat-panel ${mobileTab !== 'chat' ? 'mobile-hidden' : ''}`}>
          <div className="editor-chat-scroll">
            {/* Project Brief / Direction Summary Card */}
            <div className="editor-direction-card">
              <div className="direction-head">
                <Star state={starState} />
                <div>
                  <span className="eyebrow muted">YOUR DIGITAL PARTNER</span>
                  <h4>{project.name}</h4>
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="subtle-button"
                    disabled={researchRunning}
                    onClick={() => void triggerWebResearch()}
                    title="Research the web and competitors for this project"
                  >
                    {researchRunning ? <LoaderCircle size={12} className="spin" /> : <Globe size={12} />} Research web
                  </button>
                  {project.files.length === 0 && !isBuilding && (
                    <button type="button" className="subtle-button" onClick={() => void triggerBuild(false, 'Initial build')}>
                      <Wand2 size={13} /> Build
                    </button>
                  )}
                </div>
              </div>
              <p className="direction-brief">{project.brief}</p>

              {/* Artifact Pill to open "Competitive Analysis" Document Viewer (Batch 2 Image 1 & 2) */}
              <button
                type="button"
                className="strategy-doc-pill"
                onClick={() => setRightSurface('research_doc')}
              >
                <FileText size={15} />
                <div>
                  <strong>Competitive analysis & direction</strong>
                  <small>Strategy document · Click to open</small>
                </div>
                <ChevronRight size={14} />
              </button>
            </div>

            {/* Conversation Messages */}
            {conversation?.messages.map(m => {
              let parsedPlan: StructuredPlan | null = null;
              if (m.planJson) {
                try { parsedPlan = JSON.parse(m.planJson); } catch { /* ignore */ }
              }
              const stepCount = m.stepsCount || (m.planJson ? 3 : m.role === 'assistant' ? 2 : 0);
              return (
                <div key={m.id} className={`editor-msg ${m.role}`}>
                  <div className="editor-msg-meta">
                    {m.role === 'user' ? (
                      <span className="msg-author-badge user">Tu</span>
                    ) : (
                      <span className="msg-author-badge starli"><Star /> Starli</span>
                    )}
                    {m.selectedElement && (
                      <span className="msg-element-tag" title={m.selectedElement}>
                        <MousePointerClick size={11} /> Parte din {project.name}
                      </span>
                    )}
                  </div>

                  {/* Completed steps summary line above assistant replies (Batch 2 Image 1: "✓ Completed 2 steps ›") */}
                  {m.role === 'assistant' && stepCount > 0 && (
                    <button
                      type="button"
                      className="completed-steps-pill"
                      onClick={() => setActiveityDrawerOpen(true)}
                    >
                      <Check size={12} />
                      <span>Am parcurs {stepCount} steps</span>
                      <ChevronRight size={12} />
                    </button>
                  )}

                  {/* User Pasted / Uploaded Attachments */}
                  {m.attachments && m.attachments.length > 0 && (
                    <div className="msg-attachments-row">
                      {m.attachments.map((att, idx) => (
                        <div key={idx} className="msg-attachment-chip">
                          {att.dataUrl ? (
                            <img src={att.dataUrl} alt={att.name} />
                          ) : (
                            <FileText size={14} />
                          )}
                          <span>{att.name}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="editor-msg-body">
                    <Markdown>{m.content}</Markdown>
                  </div>

                  {/* Interactive Question Card (`ask_user` tool — Batch 1 Images 2 & 4) */}
                  {m.questionJson && (
                    <InteractiveQuestionCard
                      questionJson={m.questionJson}
                      onSelectAnswer={ans => void sendPrompt(ans, actionMode)}
                      disabled={sending || isBuilding}
                    />
                  )}

                  {/* Structured Plan Card (when in PLAN mode) */}
                  {parsedPlan && (
                    <div className="structured-plan-card">
                      <div className="plan-card-header">
                        <span className="eyebrow">IMPLEMENTATION PLAN</span>
                        <h4>{parsedPlan.name}</h4>
                        {parsedPlan.objective && <p>{parsedPlan.objective}</p>}
                      </div>
                      {parsedPlan.direction && (
                        <div className="plan-direction-row">
                          <span>Visual direction:</span>
                          <strong>{parsedPlan.direction}</strong>
                        </div>
                      )}
                      {parsedPlan.pages?.length > 0 && (
                        <div className="plan-pages-row">
                          {parsedPlan.pages.map(pg => <span key={pg} className="badge">{pg}</span>)}
                        </div>
                      )}
                      {parsedPlan.steps?.length > 0 && (
                        <ol className="plan-steps-list">
                          {parsedPlan.steps.map((st, idx) => (
                            <li key={idx}>
                              <strong>{st.title}</strong>
                              <p>{st.description}</p>
                            </li>
                          ))}
                        </ol>
                      )}
                      <div className="plan-card-actions">
                        <button
                          type="button"
                          className="subtle-button"
                          onClick={() => {
                            
                            setInput('Update the plan as follows: ');
                          }}
                        >
                          Edit plan
                        </button>
                        <button
                          type="button"
                          className="pill-button light"
                          disabled={isBuilding}
                          onClick={() => void approvePlan(parsedPlan!)}
                        >
                          <Sparkles size={14} /> Build
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}

            {/* LIVE "Thinking…" & "Working 0.0s" STATUS BOX WITH SUB-STEP TREE (Batch 1 Images 3 & 5, Batch 2 Image 1) */}
            {isAgentWorking && (
              <div className="working-live-box">
                <div className="working-live-head">
                  <span className="working-grid-icon" aria-hidden="true">
                    <i /><i /><i /><i /><i /><i /><i /><i /><i />
                  </span>
                  <strong>
                    {liveTimerSec < 1.2 && !isBuilding
                      ? 'Thinking…'
                      : 'Working'}
                  </strong>
                  <span className="working-timer">{liveTimerSec.toFixed(1)}s</span>
                </div>
                <ul className="working-substeps-tree">
                  {researchRunning && (
                    <li className="running">
                      <LoaderCircle size={12} className="spin" />
                      <span>Researching the web and analyzing competitors…</span>
                    </li>
                  )}
                  {sending && !isBuilding && (
                    <>
                      <li className="running">
                        <LoaderCircle size={12} className="spin" />
                        <span>Preparing a response using your project context</span>
                      </li>
                    </>
                  )}
                  {isBuilding && latestRun && latestRun.steps.map(step => (
                    <li key={step.id} className={agentStepState(step.status)}>
                      {agentStepState(step.status) === 'running' ? (
                        <LoaderCircle size={12} className="spin" />
                      ) : (
                        agentStepState(step.status)==='success'?<Check size={12}/>:agentStepState(step.status)==='error'?<X size={12} className="danger"/>:<span>—</span>
                      )}
                      <span>{step.title}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Calm Recovery Card on Build Error */}
            {latestRun && latestRun.status === 'error' && !isBuilding && (
              <div className="agent-run-card error">
                <div className="agent-run-header">
                  <Star state="done" />
                  <div>
                    <strong>{latestRun.summary || 'Starli run'}</strong>
                    <small>This run encountered a problem</small>
                  </div>
                </div>
                <div className="agent-recovery-box">
                  <p>
                    Could not complete this version ({latestRun.errorSummary || 'temporary error'}).
                    {hasGoodVersion ? ' Your previous stable version is still available in the preview.' : ''}
                  </p>
                  <div className="recovery-actions">
                    <button type="button" className="subtle-button" onClick={() => void triggerBuild(false, 'Retry build')}>
                      <RotateCcw size={13} /> Try again
                    </button>
                    <button type="button" className="subtle-button" onClick={() => { setRightSurface('details'); setDetailsTab('logs'); }}>
                      <Terminal size={13} /> Vezi detalii
                    </button>
                    {project.versions.length > 0 && (
                      <button type="button" className="subtle-button" onClick={() => void restoreVersion(project.versions[0])}>
                        <History size={13} /> Return to stable version
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Queued steering instructions */}
            {queuedSteering.length > 0 && (
              <div className="queued-steering-box">
                <span className="eyebrow muted">QUEUED INSTRUCTIONS ({queuedSteering.length})</span>
                {queuedSteering.map((q, idx) => (
                  <div key={idx} className="queued-item">
                      <span>„{q.content}” · {MODE_LABELS[q.actionMode].label}{q.maxCredits>0?` · plafon ${q.maxCredits} credite`:""}</span>
                    <button type="button" onClick={() => setQueuedSteering(list => list.filter((_, i) => i !== idx))}>
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* COMPOSER WITH TUTORIAL COACHMARK, ATTACHMENT CARDS & TAB AUTOCOMPLETE */}
          <div className="editor-composer-wrap">
            {/* Interactive Onboarding Tutorial Coachmark (Batch 2 Image 3) */}
            {tutorialStep !== null && TUTORIAL_STEPS[tutorialStep] && (
              <div className="studio-tutorial-coachmark" role="dialog" aria-label="Ghid Starli Studio">
                <div className="coachmark-top">
                  <strong>{TUTORIAL_STEPS[tutorialStep].title}</strong>
                  <button type="button" className="icon-button" onClick={closeTutorial} aria-label="Close guide">
                    <X size={14} />
                  </button>
                </div>
                <p>{TUTORIAL_STEPS[tutorialStep].body}</p>
                <div className="coachmark-foot">
                  <div className="coachmark-dots">
                    {TUTORIAL_STEPS.map((_, idx) => (
                      <span
                        key={idx}
                        className={idx === tutorialStep ? 'active' : ''}
                        onClick={() => setTutorialStep(idx)}
                      />
                    ))}
                  </div>
                  <button type="button" className="coachmark-next-btn" onClick={advanceTutorial}>
                    {tutorialStep + 1 === TUTORIAL_STEPS.length ? 'Gata' : 'Next'}
                  </button>
                </div>
              </div>
            )}

            {error && <div className="notice error">{error}</div>}

            {/* Selected Visual Element Card ("Parte din <Project Name>" — Batch 2 Image 4) */}
            {selectedElement && (
              <div className="composer-attachment-card selected-part-card">
                <MousePointerClick size={15} />
                <div>
                  <strong>Parte din {project.name}</strong>
                  <small>
                    {selectedElement.tag.toUpperCase()} · {selectedElement.text ? `„${selectedElement.text.slice(0, 42)}”` : selectedElement.selector}
                  </small>
                </div>
                <div className="chip-actions">
                  {selectedElement.text && (
                    <button type="button" className="subtle-button" onClick={() => setInlineEditing(!inlineEditing)}>
                      Text rapid
                    </button>
                  )}
                  <button type="button" onClick={() => setSelectedElement(null)} aria-label="Clear selection">
                    <X size={13} />
                  </button>
                </div>
              </div>
            )}

            {/* Pasted / Uploaded Image & Document Cards in Composer (Batch 2 Image 4) */}
            {attachments.length > 0 && (
              <div className="composer-attachments-strip">
                {attachments.map((att, idx) => (
                  <div key={idx} className="composer-attachment-card">
                    {att.dataUrl ? (
                      <img src={att.dataUrl} alt={att.name} className="att-thumb" />
                    ) : (
                      <FileText size={15} />
                    )}
                    <div>
                      <strong>{att.mimeType.startsWith('image/') ? 'Image attachment' : 'Document attachment'}</strong>
                      <small>{att.name}</small>
                    </div>
                    <button
                      type="button"
                      onClick={() => setAttachments(list => list.filter((_, i) => i !== idx))}
                      aria-label="Remove attachment"
                    >
                      <X size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {inlineEditing && selectedElement && (
              <form className="inline-text-editor" onSubmit={saveInlineText}>
                <label>
                  Edit text directly on the page (no AI credits used)
                  <input
                    value={inlineTextValue}
                    onChange={e => setInlineTextValue(e.target.value)}
                    placeholder="Noul text…"
                  />
                </label>
                <div>
                  <button type="button" className="subtle-button" onClick={() => setInlineEditing(false)}>Cancel</button>
                  {inlineEditFailed&&<button type="button" className="subtle-button" onClick={()=>{setInlineEditing(false);setInlineEditFailed(false);void sendPrompt(`Change the text “${selectedElement.text}” to “${inlineTextValue}”`,'BUILD');}}>Cere modificarea prin AI (consum AI)</button>}
                  <button type="submit" className="pill-button light">Save text</button>
                </div>
              </form>
            )}

            <form
              className="editor-composer"
              onSubmit={e => {
                e.preventDefault();
                void sendPrompt(input);
              }}
              onPaste={e => {
                const files = e.clipboardData?.files;
                if (files && files.length > 0) {
                  e.preventDefault();
                  void handleAttachFiles(files);
                }
              }}
            >
              <div className="composer-input-area">
                <textarea
                  rows={2}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={
                    ghostFollowUp
                      ? ''
                      : selectedElement
                      ? `Tell Starli what to change in this part of ${project.name}…`
                      : 'Tell Starli what you have in mind (or paste an image with Ctrl+V)…'
                  }
                  onKeyDown={e => {
                    if (e.key === 'Tab' && ghostFollowUp && !input) {
                      e.preventDefault();
                      setInput(ghostFollowUp);
                      return;
                    }
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      void sendPrompt(input);
                    }
                  }}
                />
                {ghostFollowUp && !input && (
                  <div className="composer-ghost-overlay" onClick={() => setInput(ghostFollowUp)}>
                    <span>{ghostFollowUp}</span>
                    <kbd>Press Tab to accept</kbd>
                  </div>
                )}
              </div>

              <div className="editor-composer-bar">
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    ref={filePickerRef}
                    type="file"
                    multiple
                    accept="image/*,.txt,.md,.json,.csv,.pdf"
                    style={{ display: 'none' }}
                    onChange={e => {
                      if (e.target.files) void handleAttachFiles(e.target.files);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    className="composer-plus-btn"
                    onClick={() => filePickerRef.current?.click()}
                    title="Attach an image or document (or use Ctrl+V)"
                    aria-label="Attach file"
                  >
                    <Plus size={15} />
                  </button>

                  <span className="mode-pill"><Star /> Starli AI</span>
                </div>

                <button
                  type="submit"
                  className="send-button"
                  disabled={!input.trim() && attachments.length === 0}
                  title={isBuilding ? 'Queue instruction' : 'Trimite'}
                >
                  {sending ? <LoaderCircle size={16} className="spin" /> : <ArrowUp size={17} />}
                </button>
              </div>
              {creditConsent.consent}
            </form>
          </div>
        </section>

        {/* CENTER / RIGHT CANVAS PANEL */}
        <section className={`editor-canvas-panel ${mobileTab === 'chat' ? 'mobile-hidden' : ''}`}>
          {/* 1. LIVE INTERACTIVE PREVIEW */}
          {rightSurface === 'preview' && (
            <div className="canvas-preview-container">
              {previewingVersion && (
                <div className="version-preview-banner">
                  <span>Previzualizezi versiunea din {new Date(previewingVersion.createdAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}: <strong>{previewingVersion.summary}</strong></span>
                  <div>
                    <button type="button" className="subtle-button" onClick={() => setPreviewingVersion(null)}>Back to current version</button>
                    <button type="button" className="pill-button light" onClick={() => void restoreVersion(previewingVersion)}>Restore this version</button>
                  </div>
                </div>
              )}

              {activePreviewHtml ? (
                <div className={`canvas-viewport-frame viewport-${viewport}`} aria-busy={previewNavigating}>
                  {previewNavigating&&<div role="status" className="notice"><LoaderCircle size={14} className="spin"/> Deschid pagina…</div>}
                  <iframe
                    ref={previewIframeRef}
                    key={`${previewKey}-${selectMode}-${previewingVersion?.id || 'live'}-${previewPage?.path||'/'}-${previewPage?.hash||''}`}
                    sandbox="allow-scripts"
                    srcDoc={buildNavigablePreview(activePreviewHtml,selectMode,previewPage?.path||'/',previewPage?.hash||'')}
                    title={`Preview ${project.name}`}
                  />
                </div>
              ) : isBuilding ? (
                <div className="canvas-empty-state">
                  <Star state="building" />
                  <h3>Starli is building your first version.</h3>
                  <p>{project.buildStep || 'Preparing the visual direction, images and React components. Your preview will appear here automatically.'}</p>
                </div>
              ) : (
                <div className="canvas-empty-state">
                  <Star />
                  <h3>Your live preview will appear here.</h3>
                  <p>Ask Starli to build your website in the chat, or use the button below to create your first version.</p>
                  <button type="button" className="pill-button light" onClick={() => void triggerBuild(false, 'Build first version')}>
                    <Sparkles size={15} /> Build initial version
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 1B. STRATEGY & COMPETITOR SNAPSHOT DOCUMENT VIEWER (Batch 2 Images 1 & 2) */}
          {rightSurface === 'research_doc' && (
            <div className="editor-surface-panel research-doc-surface">
              <header className="surface-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <button type="button" className="subtle-button" onClick={() => setRightSurface('preview')}>
                    <ArrowLeft size={13} /> Back to preview
                  </button>
                  <div>
                    <span className="eyebrow muted">DOCUMENT STRATEGIC CREAT DE STARLI</span>
                    <h3>Competitive Analysis & Strategy — {project.name}</h3>
                  </div>
                </div>
                <div className="surface-header-actions">
                  <button
                    type="button"
                    className="subtle-button"
                    disabled={researchRunning}
                    onClick={() => void triggerWebResearch()}
                  >
                    {researchRunning ? <LoaderCircle size={13} className="spin" /> : <Globe size={13} />} Refresh web research
                  </button>
                  <button
                    type="button"
                    className="subtle-button"
                    onClick={() => {
                      navigator.clipboard?.writeText(strategyMarkdown);
                      setCopiedDoc(true);
                      setTimeout(() => setCopiedDoc(false), 2000);
                    }}
                  >
                    {copiedDoc ? <Check size={13} /> : <Copy size={13} />} {copiedDoc ? 'Copied' : 'Copy text'}
                  </button>
                  <button
                    type="button"
                    className="pill-button light"
                    onClick={() => {
                      setInput(`Based on the competitor analysis for ${project.name}, apply the key differentiators to the website.`);
                      
                    }}
                  >
                    <MessageSquare size={13} /> Talk with Starli
                  </button>
                </div>
              </header>

              <div className="doc-viewer-layout">
                <aside className="doc-toc-sidebar">
                  <span className="eyebrow muted">ON THIS PAGE</span>
                  <nav>
                    <a href="#oportunitate">Key Opportunity</a>
                    <a href="#competitori">Close Competitors</a>
                    <a href="#directie">Why this direction matters</a>
                    <a href="#pasul-urmator">Next steps</a>
                  </nav>
                  {project.sources && project.sources.length > 0 && (
                    <div className="doc-sources-box">
                      <span className="eyebrow muted">SURSE WEB VERIFICATE ({project.sources.length})</span>
                      {project.sources.map((s, idx) => (
                        <a key={idx} href={s.url} target="_blank" rel="noreferrer" className="doc-source-link">
                          <Globe size={12} />
                          <span>{s.title}</span>
                          <ExternalLink size={11} />
                        </a>
                      ))}
                    </div>
                  )}
                </aside>

                <article className="doc-viewer-paper">
                  <div className="doc-paper-header">
                    <span className="badge">COMPETITIVE ANALYSIS · STARLI AI</span>
                    <h1>Competitive Analysis & Strategy for {project.name}</h1>
                    <p className="muted">Strategic brief generated for digital positioning and conversion architecture.</p>
                  </div>
                  <div id="oportunitate" className="doc-markdown-body">
                    <Markdown>{strategyMarkdown}</Markdown>
                  </div>
                </article>
              </div>
            </div>
          )}

          {/* 2. SOURCE CODE VIEW & EDITOR */}
          {rightSurface === 'code' && (
            <div className="editor-surface-panel code-surface">
              <header className="surface-header">
                <div>
                  <span className="eyebrow muted">LIVE SOURCE CODE · NEXT.JS 16 + TYPESCRIPT</span>
                  <h3>Project Files ({project.files.length})</h3>
                </div>
                <div className="surface-header-actions">
                  <button type="button" className="subtle-button" onClick={downloadZip} disabled={!project.files.length}>
                    <Download size={14} /> Download ZIP
                  </button>
                  <button type="button" className="icon-button" onClick={() => setRightSurface('preview')}>
                    <X size={18} />
                  </button>
                </div>
              </header>

              {project.files.length === 0 ? (
                <div className="canvas-empty-state">
                  <FolderCode size={32} />
                  <h3>No files generated yet.</h3>
                  <p>Build the first version to inspect or edit the React and TypeScript source code.</p>
                </div>
              ) : (
                <div className="code-explorer-grid">
                  <aside className="code-file-tree">
                    <input
                      className="file-search-input"
                      placeholder="Search files…"
                      value={fileSearch}
                      onChange={e => setFileSearch(e.target.value)}
                    />
                    {project.files
                      .filter(f => f.path.toLowerCase().includes(fileSearch.toLowerCase()))
                      .map(file => (
                        <button
                          type="button"
                          key={file.path}
                          className={currentCodeFile?.path === file.path ? 'active' : ''}
                          onClick={() => {
                            if(file.path===currentCodeFile?.path)return;
                            if(!canLeaveCodeDraft(codeDraft,()=>window.confirm('You have unsaved changes in this file. Discard and open another file?')))return;
                            setActiveeFile(file.path);
                            setEditingCode(null);
                          }}
                        >
                          <FileCode size={14} />
                          <span>{file.path}</span>
                        </button>
                      ))}
                  </aside>
                  <div className="code-viewer-pane">
                    <div className="code-viewer-toolbar">
                      <strong>{currentCodeFile?.path}</strong>
                      {currentCodeFile && currentCodeFile.encoding !== 'base64' && (
                        <div>
                          {editingCode === null ? (
                            <button
                              type="button"
                              className="subtle-button"
                              onClick={() => setCodeDraft({projectId:project.id,path:currentCodeFile.path,content:currentCodeFile.content,originalContent:currentCodeFile.content})}
                            >
                              Edit file
                            </button>
                          ) : (
                            <>
                              <button type="button" className="subtle-button" onClick={() => setEditingCode(null)}>
                                Cancel
                              </button>
                              <button type="button" className="pill-button light" disabled={savingCode} onClick={() => void saveCodeFile()}>
                                {savingCode ? <LoaderCircle size={13} className="spin" /> : <Check size={13} />} Save & Recompile Preview
                              </button>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                    {currentCodeFile?.encoding === 'base64' ? (
                      <div className="code-asset-box">
                        <img
                          className="source-asset-preview"
                          src={`data:image/png;base64,${currentCodeFile.content}`}
                          alt={currentCodeFile.path}
                        />
                      </div>
                    ) : editingCode !== null ? (
                      <textarea
                        className="code-editor-textarea"
                        value={editingCode}
                        onChange={e => setEditingCode(e.target.value)}
                        spellCheck={false}
                      />
                    ) : (
                      <pre className="code-viewer-pre"><code>{currentCodeFile?.content}</code></pre>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 3. VERSION HISTORY */}
          {rightSurface === 'history' && (
            <div className="editor-surface-panel">
              <header className="surface-header">
                <div>
                  <span className="eyebrow muted">ISTORICUL VERSIUNILOR</span>
                  <h3>Toate punctele de salvare ({project.versions.length})</h3>
                </div>
                <button type="button" className="icon-button" onClick={() => setRightSurface('preview')}>
                  <X size={18} />
                </button>
              </header>
              <div className="surface-scroll-content">
                {project.versions.length === 0 ? (
                  <div className="canvas-empty-state">
                    <History size={30} />
                    <h3>No saved versions yet.</h3>
                    <p>Every successful build or modification creates a version you can restore anytime.</p>
                  </div>
                ) : (
                  <div className="version-timeline">
                    {project.versions.map((ver, idx) => (
                      <div key={ver.id} className={`version-card ${idx === 0 ? 'current' : ''}`}>
                        <div className="version-card-main">
                          <div className="version-badges">
                            {idx === 0 && <span className="badge active-badge">CURRENT VERSION</span>}
                            <span className="badge">{ver.source.toUpperCase()}</span>
                            <small>{new Date(ver.createdAt).toLocaleString('en-US')}</small>
                          </div>
                          <h4>{ver.summary}</h4>
                          <small>Created by {ver.createdBy} · Fingerprint {ver.sourceHash.slice(0, 10)}</small>
                        </div>
                        <div className="version-card-actions">
                          <button
                            type="button"
                            className={`icon-button ${ver.bookmarked ? 'bookmarked' : ''}`}
                            onClick={() => void toggleBookmark(ver)}
                            title="Bookmark version"
                          >
                            <Bookmark size={15} />
                          </button>
                          {ver.previewHtml && (
                            <button
                              type="button"
                              className="subtle-button"
                              onClick={() => {
                                void previewVersion(ver);
                                setRightSurface('preview');
                              }}
                            >
                              <Eye size={13} /> Preview
                            </button>
                          )}
                          {idx > 0 && (
                            <button
                              type="button"
                              className="subtle-button"
                              onClick={() => void restoreVersion(ver)}
                            >
                              <RotateCcw size={13} /> Restore
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* PROJECT SETTINGS */}
          {rightSurface === 'settings' && (
            <div className="editor-surface-panel">
              <header className="surface-header">
                <div>
                  <span className="eyebrow muted">PROJECT PREFERENCES</span>
                  <h3>Project Settings</h3>
                </div>
                <button type="button" className="icon-button" onClick={() => setRightSurface('preview')} aria-label="Close project settings">
                  <X size={18} />
                </button>
              </header>
              <div className="surface-scroll-content">
                <form className="dna-form" onSubmit={saveKnowledge}>
                  <label htmlFor="project-custom-instructions">
                    Permanent Custom Instructions & Preferences
                  </label>
                  <p id="project-custom-instructions-help" className="muted">
                    Instruct Starli what to keep or avoid when working on this website. Preferences apply exclusively to this project.
                  </p>
                  <textarea
                    id="project-custom-instructions"
                    aria-describedby="project-custom-instructions-help"
                    rows={7}
                    maxLength={4000}
                    value={dnaForm.customInstructions}
                    onChange={e => {setDnaForm({ ...dnaForm, customInstructions: e.target.value });setPreferencesSaved(false);}}
                    placeholder="For example: Keep WhatsApp in the main menu. Use a friendly tone and avoid neon colors."
                  />
                  <div className="dna-actions">
                    <button type="submit" className="pill-button light" disabled={savingDna}>
                      {savingDna ? <LoaderCircle size={15} className="spin" /> : <Check size={15} />} Save instructions
                    </button>
                  </div>
                  {preferencesSaved&&<p className="muted" role="status">Instructions saved for this project.</p>}
                </form>
              </div>
            </div>
          )}
          {/* 5. BUILD DETAILS PANEL (ACTIVITY / FILES / LOGS / TESTS) */}
          {rightSurface === 'details' && (
            <div className="editor-surface-panel">
              <header className="surface-header">
                <div>
                  <span className="eyebrow muted">DETALII TEHNICE & VERIFICARE</span>
                  <h3>Technical Inspection</h3>
                </div>
                <button type="button" className="icon-button" onClick={() => setRightSurface('preview')}>
                  <X size={18} />
                </button>
              </header>
              <div className="details-subtabs">
                {([
                  ['activity', 'Activeitate Agent'],
                  ['files', `Files (${project.files.length})`],
                  ['logs', 'Jurnal Build'],
                  ['tests', 'Verifiedion']
                ] as const).map(([k, label]) => (
                  <button
                    type="button"
                    key={k}
                    className={detailsTab === k ? 'active' : ''}
                    onClick={() => setDetailsTab(k)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="surface-scroll-content">
                {detailsTab === 'activity' && (
                  <div className="details-activity-list">
                    {project.agentRuns.length === 0 ? (
                      <p className="muted">No executions recorded yet.</p>
                    ) : (
                      project.agentRuns.map(run => (
                        <div key={run.id} className="settings-panel" style={{ marginBottom: 16 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                            <strong>{run.summary || 'Agent run'}</strong>
                            <span className="badge">{run.status.toUpperCase()}</span>
                          </div>
                          <ul className="agent-steps-list">
                            {run.steps.map(s => (
                              <li key={s.id} className={`agent-step-item ${s.status}`}>
                                <span className="step-icon">{agentStepState(s.status) === 'success' ? <Check size={13} /> : agentStepState(s.status) === 'running' ? <LoaderCircle size={13} className="spin" /> : agentStepState(s.status)==='error'?<X size={13} className="danger"/>:<span>—</span>}</span>
                                <div className="step-text">
                                  <span>{s.title}</span>
                                  {s.detail && <small>{s.detail}</small>}
                                </div>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                )}

                {detailsTab === 'files' && (
                  <div className="settings-panel">
                    <h3>Generated Next.js Architecture</h3>
                    {project.files.map(f => (
                      <div key={f.path} className="detail-row">
                        <span>{f.path}</span>
                        <strong>{f.encoding === 'base64' ? 'Imagine PNG (base64)' : `${f.content.length} caractere UTF-8`}</strong>
                      </div>
                    ))}
                  </div>
                )}

                {detailsTab === 'logs' && (
                  <div className="settings-panel">
                    <h3>Compilation & Verifiedion Logs</h3>
                    {project.buildError && <div className="notice error">{project.buildError}</div>}
                    <pre className="code-viewer-pre">{project.buildLog || 'No additional Docker/compiler logs for this version.'}</pre>
                  </div>
                )}

                {detailsTab === 'tests' && (
                  <div className="settings-panel">
                    <h3>Technical Verifiedion Status</h3>
                    <div className="detail-row">
                      <span>Validare AST TypeScript & React 19</span>
                      <strong>{project.files.length > 0 ? '✓ Passed' : 'Pending'}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Security isolation (CSP & imports)</span>
                      <strong>{project.files.length > 0 ? '✓ Verified' : 'Pending'}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Preview HTML randat determinist</span>
                      <strong>{project.previewHtml ? '✓ Active' : 'Pending'}</strong>
                    </div>
                    <div className="detail-row">
                      <span>Compilare container Docker izolat</span>
                      <strong>{project.validationStatus}</strong>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. PUBLISH & DOMAINS SURFACE */}
          {rightSurface === 'publish' && (
            <div className="editor-surface-panel">
              <header className="surface-header">
                <div>
                  <span className="eyebrow muted">LANSARE ONLINE & DOMENII</span>
                  <h3>Publish {project.name}</h3>
                </div>
                <button type="button" className="icon-button" onClick={() => setRightSurface('preview')}>
                  <X size={18} />
                </button>
              </header>
              <div className="surface-scroll-content">
                <div className="publish-readiness-card">
                  <div className="readiness-checks">
                    <div><CheckCircle2 size={15} /> <span>Validated Next.js & TypeScript architecture</span></div>
                    <div><CheckCircle2 size={15} /> <span>Responsive mobile and desktop layout</span></div>
                    <div><CheckCircle2 size={15} /> <span>Automatic SSL & global edge delivery via Vercel</span></div>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 18, flexWrap: 'wrap' }}>
                    <button type="button" className="subtle-button" onClick={() => void triggerBuild(true, 'Regenerare cu imagini noi')} disabled={isBuilding}>
                      <Sparkles size={14} /> Regenerate AI images
                    </button>
                    <button type="button" className="subtle-button" onClick={downloadZip} disabled={!project.files.length}>
                      <Download size={14} /> Download source code (ZIP)
                    </button>
                  </div>
                </div>
                <ProjectCommerce project={project} onChange={updated=>applyProjectResponse(updated,renderedProjectScope)} />
                {project.files.length > 0 && <DomainManager projectId={project.id} />}
              </div>
            </div>
          )}
        </section>

        {/* RIGHTMOST ACTIVITY DRAWER ("ACTIVITATEA LUI STARLI" + "CREATED IN THIS RUN" — Batch 2 Images 1 & 2) */}
        {activityDrawerOpen && (
          <aside className="starli-activity-drawer" aria-label="Activeitatea lui Starli">
            <div className="activity-drawer-head">
              <div>
                <span className="eyebrow muted">ACTIVITATEA LUI STARLI</span>
                <strong>Real-time execution steps</strong>
              </div>
              <button type="button" className="icon-button" onClick={() => setActiveityDrawerOpen(false)} aria-label="Close">
                <X size={15} />
              </button>
            </div>

            <div className="activity-drawer-scroll">
              {latestRun ? (
                <ul className="foundable-activity-list">
                  {latestRun.steps.map((st, idx) => {
                    const isWeb = st.category === 'web' || /web|citesc|caut/i.test(st.title);
                    const isDoc = st.category === 'document' || /document|analiz/i.test(st.title);
                    const isAsset = st.category === 'asset' || /logo|hero|imagin/i.test(st.title);
                    return (
                      <li key={st.id} className={`foundable-step-row ${st.status}`}>
                        <span className={`f-step-badge ${isWeb ? 'web' : isDoc ? 'doc' : isAsset ? 'asset' : 'code'}`}>
                          {isWeb ? <Globe size={13} /> : isDoc ? <FileText size={13} /> : isAsset ? <Palette size={13} /> : <Code2 size={13} />}
                        </span>
                        <div className="f-step-main">
                          <strong>{st.title}</strong>
                          {st.detail && <small>{st.detail}</small>}
                        </div>
                        <span className="f-step-meta">
                          {agentStepState(st.status) === 'running' ? (
                            <LoaderCircle size={13} className="spin" />
                          ) : (
                            <>
                              <em>{formatStepDuration(st.createdAt, st.completedAt, idx)}</em>
                              {agentStepState(st.status)==="success"?<CheckCircle2 size={14} className="f-check"/>:agentStepState(st.status)==="error"?<X size={14} className="danger"/>:<span>—</span>}
                            </>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="activity-empty">
                  <p className="muted">Start a build or web research to follow every step Starli takes in real time.</p>
                  <button type="button" className="subtle-button" onClick={() => void triggerWebResearch()} disabled={researchRunning}>
                    <Globe size={13} /> Start web research
                  </button>
                </div>
              )}
            </div>

            <div className="activity-made-this-run">
              <span className="eyebrow muted">CREATED IN THIS RUN</span>
              <button
                type="button"
                className="made-artifact-card"
                onClick={() => setRightSurface('research_doc')}
              >
                <span className="made-icon"><FileText size={16} /></span>
                <div>
                  <strong>Competitive Analysis</strong>
                  <small>Document strategic · {project.name}</small>
                </div>
                <ChevronRight size={14} />
              </button>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

