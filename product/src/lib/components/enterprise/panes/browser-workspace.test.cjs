const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
const svelte = require('svelte/compiler');

async function compile(file) {
	const source = fs.readFileSync(file, 'utf8');
	const pre = await svelte.preprocess(
		source,
		[
			{
				script({ content, attributes }) {
					if (attributes.lang !== 'ts') return { code: content };
					const result = ts.transpileModule(content, {
						compilerOptions: {
							module: ts.ModuleKind.ESNext,
							target: ts.ScriptTarget.ES2022,
							verbatimModuleSyntax: false
						}
					});
					return { code: result.outputText };
				}
			}
		],
		{ filename: file }
	);
	const out = svelte.compile(pre.code, { filename: file, generate: 'dom' });
	assert.ok(out.js && out.js.code.length > 0, `Expected compiled JS for ${file}`);
	return { source, out };
}

(async () => {
	const pane = await compile('src/lib/components/enterprise/panes/BrowserWorkspacePane.svelte');
	const activity = await compile('src/lib/components/enterprise/Activity.svelte');
	const page = await compile('src/routes/app/+page.svelte');

	// 1. BrowserWorkspacePane must map backend codes cleanly and only revoke session on 401/abort.
	assert.ok(
		pane.source.includes('BROWSER_NATIVE_RUN_UNAVAILABLE') &&
			pane.source.includes('BROWSER_AUTHORITY_DENIED') &&
			pane.source.includes('BROWSER_URL_BLOCKED') &&
			pane.source.includes('BROWSER_NAVIGATION_FAILED'),
		'Diagnostic codes must be mapped cleanly'
	);
	assert.ok(
		pane.source.includes('if(response.status===401){revoke();') &&
			!pane.source.includes('[401,403,404].includes(response.status)'),
		'403/404 diagnostics must surface visibly rather than silently triggering revoke'
	);
	assert.ok(
		pane.source.includes('frameId:frame?.frameId??null') &&
			pane.source.includes('data.url!==lastFrameUrl'),
		'Action requests must send frameId and preserve in-progress URL input edits across polls'
	);

	// 2. Activity must emit browser events for live/active runs and never force-open on historical ANSWERED turns.
	assert.ok(
		activity.source.includes("const startedActive=['QUEUED','RUNNING'].includes(turn.status);") &&
			activity.source.includes("(startedActive||active)&&event.type==='tool.lifecycle'") &&
			activity.source.includes("event.publicToolName.startsWith('browser.')"),
		'Activity must gate browser event dispatch to active/startedActive turns'
	);

	// 3. /app page must wire room-session discovery, direct-{room} open, on:browser auto-open, and cleanup.
	assert.ok(
		page.source.includes("'/browser/room-session?'") &&
			page.source.includes("fallbackTurn?.runId||('direct-'+room.id)") &&
			page.source.includes("['RUNNING','ANSWERED'].includes(t.status)"),
		'App workspace must support /room-session discovery and direct-{room} open without using CANCELLED runs'
	);
	assert.ok(
		page.source.includes("on:browser={event=>void presentBrowserWorkspace(event.detail,event.detail.toolName==='browser.navigate')}") &&
			page.source.includes('browserDismissed.clear()') &&
			page.source.includes('void refreshBrowserWorkspace();'),
		'App workspace must bind Activity on:browser, poll room-session, and clear browser state on revoke'
	);

	console.log('PASS browser workspace Svelte compilation and wiring invariants');
})().catch((err) => {
	console.error(err);
	process.exit(1);
});
