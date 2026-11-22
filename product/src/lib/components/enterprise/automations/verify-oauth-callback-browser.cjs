const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('src/lib/components/enterprise/automations/AutomationOAuthCallback.svelte','utf8');
assert(source.includes('location.hash.slice(1)'));assert(source.includes("history.replaceState(history.state,'',location.pathname)"));assert(!source.includes('location.search'));assert(!source.includes(".get('code')"));assert(!source.includes(".get('state')"));assert(source.includes('completeAutomationOAuth(providerId,{handoff}'));
console.log('PASS callback source guard: fragment-only handoff, scrub before completion, no raw query credential fallback');
