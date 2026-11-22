/**
 * StarliDigital Hosted AI Agents - Lightweight Embed Loader
 * Version: 1.0.0
 * Zero dependencies, framework-independent, secure iframe embed.
 * Usage: <script src="https://starlidigital.ro/agent.js" data-agent="PUBLIC_AGENT_ID"></script>
 */
(function () {
  'use strict';

  // Find the currently executing script tag
  var currentScript = document.currentScript || (function () {
    var scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  if (!currentScript) return;

  var agentId = currentScript.getAttribute('data-agent');
  if (!agentId) {
    console.warn('[StarliDigital Agent] Missing required data-agent attribute.');
    return;
  }

  // Derive origin from script src
  var scriptUrl;
  try {
    scriptUrl = new URL(currentScript.src);
  } catch (e) {
    scriptUrl = { origin: window.location.origin };
  }

  var baseUrl = scriptUrl.origin;
  var embedUrl = baseUrl + '/ai/embed/' + encodeURIComponent(agentId);

  // Prevent multiple initializations on the same page
  if (document.getElementById('starli-agent-root-' + agentId)) {
    return;
  }

  // Inject styles for floating launcher and widget modal
  var style = document.createElement('style');
  style.id = 'starli-agent-styles-' + agentId;
  style.textContent = [
    '#starli-agent-launcher-' + agentId + ' {',
    '  position: fixed;',
    '  bottom: 24px;',
    '  right: 24px;',
    '  width: 58px;',
    '  height: 58px;',
    '  border-radius: 50%;',
    '  background: #b8a4ff;',
    '  color: #171324;',
    '  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.28);',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  cursor: pointer;',
    '  z-index: 2147483646;',
    '  border: 0;',
    '  outline: none;',
    '  transition: transform 0.2s ease, box-shadow 0.2s ease;',
    '}',
    '#starli-agent-launcher-' + agentId + ':hover {',
    '  transform: scale(1.05);',
    '  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);',
    '}',
    '#starli-agent-launcher-' + agentId + ' svg {',
    '  width: 28px;',
    '  height: 28px;',
    '  fill: currentColor;',
    '}',
    '#starli-agent-container-' + agentId + ' {',
    '  position: fixed;',
    '  bottom: 96px;',
    '  right: 24px;',
    '  width: 390px;',
    '  height: 620px;',
    '  max-width: calc(100vw - 32px);',
    '  max-height: calc(100vh - 120px);',
    '  background: #0c0e14;',
    '  border-radius: 16px;',
    '  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);',
    '  border: 1px solid rgba(255, 255, 255, 0.1);',
    '  overflow: hidden;',
    '  display: none;',
    '  flex-direction: column;',
    '  z-index: 2147483647;',
    '  transition: opacity 0.2s ease, transform 0.2s ease;',
    '}',
    '#starli-agent-container-' + agentId + '.is-open {',
    '  display: flex;',
    '}',
    '#starli-agent-iframe-' + agentId + ' {',
    '  width: 100%;',
    '  height: 100%;',
    '  border: 0;',
    '  background: transparent;',
    '}',
    '@media (max-width: 480px) {',
    '  #starli-agent-container-' + agentId + ' {',
    '    bottom: 0;',
    '    right: 0;',
    '    width: 100vw;',
    '    height: 100vh;',
    '    max-width: 100vw;',
    '    max-height: 100vh;',
    '    border-radius: 0;',
    '  }',
    '  #starli-agent-launcher-' + agentId + '.is-hidden {',
    '    display: none;',
    '  }',
    '}'
  ].join('\n');
  document.head.appendChild(style);

  // Wrapper element
  var root = document.createElement('div');
  root.id = 'starli-agent-root-' + agentId;

  // Floating Launcher button
  var launcher = document.createElement('button');
  launcher.id = 'starli-agent-launcher-' + agentId;
  launcher.setAttribute('aria-label', 'Chat with AI Support Agent');
  launcher.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';

  // Container & Iframe
  var container = document.createElement('div');
  container.id = 'starli-agent-container-' + agentId;

  var iframe = document.createElement('iframe');
  iframe.id = 'starli-agent-iframe-' + agentId;
  iframe.title = 'StarliDigital AI Chat Assistant';
  iframe.src = embedUrl;
  iframe.setAttribute('allow', 'clipboard-write');
  iframe.setAttribute('loading', 'lazy');

  container.appendChild(iframe);
  root.appendChild(launcher);
  root.appendChild(container);

  var isOpen = false;

  launcher.addEventListener('click', function () {
    isOpen = !isOpen;
    if (isOpen) {
      container.classList.add('is-open');
      launcher.innerHTML = '<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>';
    } else {
      container.classList.remove('is-open');
      launcher.innerHTML = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg>';
    }
  });

  // Ensure DOM is ready before appending
  if (document.body) {
    document.body.appendChild(root);
  } else {
    window.addEventListener('DOMContentLoaded', function () {
      document.body.appendChild(root);
    });
  }
})();
