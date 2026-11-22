import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, BarChart3, BookOpen, Brain, BriefcaseBusiness, CheckSquare, ChevronRight, CreditCard, FileText, Film, Globe, Image, LayoutDashboard, Mail, Menu, MessageSquare, PanelLeftClose, RefreshCw, Search, Settings2, ShieldCheck, Sparkles, Users, Wallet, X } from 'lucide-react';
import './admin.css';

const groups = [
  { name: 'Relationships', items: [
    { id: 'overview', label: 'Today', icon: LayoutDashboard, description: 'The conversations and client handoffs that deserve your attention.' },
    { id: 'crm', label: 'Prospects', icon: Users, description: 'Find the next great client. Keep every relationship moving.' },
    { id: 'pipeline', label: 'Sales pipeline', icon: BriefcaseBusiness, description: 'Turn promising conversations into signed projects.' },
    { id: 'tasks', label: 'Tasks', icon: CheckSquare, description: 'The next step, for every relationship.' },
    { id: 'mailbox', label: 'Email', icon: Mail, description: 'Your client conversations, connected to the work.' },
    { id: 'reporting', label: 'Reports', icon: BarChart3, description: 'Understand what is moving your agency forward.' },
  ] },
  { name: 'Delivery', items: [
    { id: 'agents', label: 'AI Agents', icon: Sparkles, description: 'Create, host and manage business AI agents in one place.' },
    { id: 'videos', label: 'Video Studio', icon: Film, description: 'Direct and render programmatic social media videos with Starli AI.' },
    { id: 'proposals', label: 'Proposals', icon: FileText, description: 'Give your next client something worth saying yes to.' },
    { id: 'assets', label: 'Brand assets', icon: Image, description: 'A shared home for the visuals behind your projects.' },
    { id: 'operator', label: 'Starli operations', icon: Sparkles, description: 'Monitor the work and direct your AI agency.' },
    { id: 'inbox', label: 'Support inbox', icon: MessageSquare, description: 'Stay close to your customers.' },
  ] },
  { name: 'Agency', items: [
    { id: 'system', label: 'Platform overview', icon: LayoutDashboard, description: 'A clear view of your platform and its activity.' },
    { id: 'users', label: 'Customers', icon: ShieldCheck, description: 'Manage accounts and customer access.' },
    { id: 'payments', label: 'Payments', icon: CreditCard, description: 'Track payments and delivery commitments.' },
    { id: 'wallet', label: 'Credits & billing', icon: Wallet, description: 'Manage usage and the commercial side of your platform.' },
    { id: 'blog', label: 'Journal', icon: BookOpen, description: 'Create useful stories for the people you serve.' },
    { id: 'memory', label: 'Starli knowledge', icon: Brain, description: 'Give Starli the context to do better work.' },
    { id: 'integrations', label: 'Integrations', icon: Settings2, description: 'Connect and monitor the services behind your agency.' },
  ] },
];
export const ADMIN_VIEWS = groups.flatMap(group => group.items).map(item => item.id);

export function AdminShell({ view, onView, onRefresh, username, children }: {
  view: string; onView: (view: string) => void; onRefresh: () => void; username: string; children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLElement && (event.target.matches('input,textarea,select') || event.target.isContentEditable))) { event.preventDefault(); setOpen(true); searchInput.current?.focus(); }
      if (event.key === 'Escape') { setOpen(false); setSearch(''); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  const current = groups.flatMap(group => group.items).find(item => item.id === view) || groups[0].items[0];
  return <div className="agency-admin">
    {open && <button className="agency-scrim" aria-label="Close navigation" onClick={() => setOpen(false)} />}
    <aside className={`agency-sidebar ${open ? 'is-open' : ''}`} aria-label="Agency navigation">
      <Link className="agency-wordmark" to="/app/admin"><span className="agency-mark">✦</span><span>starli<span className="agency-wordmark-sub">AGENCY OS</span></span></Link>
      <div className="agency-workspace"><span className="agency-workspace-avatar">S</span><div><strong>StarliDigital</strong><small>Agency workspace</small></div><ShieldCheck size={15} /></div>
      <label className="agency-search"><Search size={15} /><input ref={searchInput} aria-label="Find an admin section" placeholder="Find a section…" value={search} onChange={event => setSearch(event.target.value)} /><kbd>/</kbd></label>
      <nav>{groups.map(group => {
        const items = group.items.filter(item => item.label.toLowerCase().includes(search.toLowerCase()));
        return items.length > 0 && <div className="agency-nav-group" key={group.name}><h2>{group.name}</h2>{items.map(item => <button key={item.id} className={view === item.id ? 'is-active' : ''} aria-current={view === item.id ? 'page' : undefined} onClick={() => { onView(item.id); setOpen(false); }}><item.icon size={17} /><span>{item.label}</span>{view === item.id && <span className="agency-active-dot" />}</button>)}</div>;
      })}</nav>
      <div className="agency-sidebar-footer"><Link to="/app"><PanelLeftClose size={16} /> Client workspace <ArrowUpRight size={13} /></Link><div className="agency-account"><span>{username.slice(0, 1).toUpperCase()}</span><div><strong>{username}</strong><small>Administrator</small></div><ShieldCheck size={15} /></div></div>
    </aside>
    <div className="agency-main">
      <header className="agency-topbar"><div><button className="agency-mobile-toggle" aria-label={open ? 'Close navigation' : 'Open navigation'} onClick={() => setOpen(!open)}>{open ? <X size={19} /> : <Menu size={19} />}</button><span>Workspace</span><ChevronRight size={13} /><strong>{current.label}</strong></div><div><span className="agency-admin-badge"><ShieldCheck size={12} /> Admin access</span><a href="/" target="_blank" rel="noreferrer"><Globe size={15} /><span>Visit website</span><ArrowUpRight size={13} /></a></div></header>
      <main className="agency-content"><div className="agency-page-heading"><div><div className="agency-kicker">STARLIDIGITAL / {groups.find(group => group.items.some(item => item.id === view))?.name.toUpperCase()}</div><h1>{current.label}<span>.</span></h1><p>{current.description}</p></div><button className="agency-refresh" onClick={onRefresh}><RefreshCw size={15} /> Refresh</button></div>{children}</main>
    </div>
  </div>;
}
