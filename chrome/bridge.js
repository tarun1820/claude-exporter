// Bridge page — distills a conversation (or a merged set of conversations from
// a project) into an editable handoff package, then exports it as a Markdown
// prompt or JSON package for pasting into a different LLM.

if (typeof initErrorCapture === 'function') initErrorCapture('bridge');

const EDITABLE_SECTIONS = ['objectives', 'completedTasks', 'pendingWork', 'decisions', 'preferences'];
const SECTION_TITLES = {
  objectives: 'Objectives',
  completedTasks: 'Completed Work',
  pendingWork: 'Pending Work / Where We Left Off',
  decisions: 'Key Decisions',
  preferences: 'User Preferences',
};

// Provider-specific storage key + display info for the AI-enhanced pass —
// mirrors the same mapping used in options.js. 'local' has no fixed host —
// it's the user's own configured Ollama address, filled in at runtime.
const PROVIDER_INFO = {
  anthropic: { keyField: 'bridgeApiKeyAnthropic', label: 'Anthropic', host: 'api.anthropic.com' },
  openai: { keyField: 'bridgeApiKeyOpenAI', label: 'OpenAI', host: 'api.openai.com' },
  gemini: { keyField: 'bridgeApiKeyGemini', label: 'Google Gemini', host: 'generativelanguage.googleapis.com' },
  local: { keyField: 'bridgeApiKeyLocal', label: 'Local (Ollama)', host: null },
};

let bridgeContext = null;
let rawBranchText = '';
let apiKeyConfigured = false;

function showStatus(message, type = 'info') {
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = type;
}

// Find a claude.ai tab and relay a message to its content script.
function sendMessageToClaudeTab(action, data) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ url: 'https://claude.ai/*' }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!tabs || tabs.length === 0) {
        reject(new Error('Please open a claude.ai tab first to use the Bridge.'));
        return;
      }
      chrome.tabs.sendMessage(tabs[0].id, { action, ...data }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve(response);
        } else {
          reject(new Error(response?.error || 'Request failed'));
        }
      });
    });
  });
}

function getBranchText(data) {
  return getCurrentBranch(data)
    .map(m => {
      const sender = m.sender === 'human' ? 'User' : 'Claude';
      const text = (m.content || [])
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text)
        .join(' ') || m.text || '';
      return `${sender}: ${text}`;
    })
    .join('\n\n');
}

function renderSections() {
  const container = document.getElementById('sections');
  container.innerHTML = '';

  for (const key of EDITABLE_SECTIONS) {
    const section = document.createElement('div');
    section.className = 'section';
    const items = bridgeContext[key] || [];
    section.innerHTML = `
      <h2>${SECTION_TITLES[key]} <span class="count">(${items.length})</span></h2>
      <textarea id="field-${key}" data-key="${key}">${items.join('\n')}</textarea>
      <div class="hint">One item per line — edit freely before exporting.</div>
    `;
    container.appendChild(section);
  }

  const codeCount = (bridgeContext.codeSnippets || []).length;
  const fileCount = (bridgeContext.files || []).length;
  const codeSection = document.createElement('div');
  codeSection.className = 'section';
  codeSection.innerHTML = `<h2>Code &amp; Files <span class="count">(${codeCount + fileCount} item(s))</span></h2>
    <div class="hint">${[...(bridgeContext.codeSnippets || []).map(c => c.title), ...(bridgeContext.files || []).map(f => f.filename)].join(', ') || 'None found'}</div>`;
  container.appendChild(codeSection);

  updatePreview();
}

// Pull the (possibly user-edited) textarea values back into bridgeContext.
function syncEditsFromUI() {
  for (const key of EDITABLE_SECTIONS) {
    const el = document.getElementById(`field-${key}`);
    if (el) {
      bridgeContext[key] = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    }
  }
}

function updatePreview() {
  syncEditsFromUI();
  document.getElementById('preview').textContent = generateBridgeMarkdown(bridgeContext);
}

function safeFilenameBase() {
  return (bridgeContext.sourceTitle || 'conversation').replace(/[<>:"/\\|?*]/g, '_');
}

async function runExtraction(mode) {
  showStatus('Extracting context…', 'info');
  bridgeContext = extractBridgeContext(window.__ceRawConversation, mode);
  renderSections();
  showStatus('Context extracted. Review and edit below before exporting.', 'success');
}

const BRIDGE_STORAGE_KEYS = [
  'bridgeProvider',
  'bridgeApiKeyAnthropic', 'bridgeApiKeyOpenAI', 'bridgeApiKeyGemini',
  'bridgeLocalBaseUrl', 'bridgeLocalModel', 'bridgeApiKeyLocal',
];

// "Configured" means different things per provider: the 3 cloud providers
// need their key present; local only needs a base URL + model — its key is
// optional (most local Ollama installs have none).
function isProviderConfigured(provider, settings) {
  if (provider === 'local') {
    return !!(settings.bridgeLocalBaseUrl && settings.bridgeLocalModel);
  }
  return !!settings[PROVIDER_INFO[provider].keyField];
}

async function checkApiKey() {
  return new Promise((resolve) => {
    chrome.storage.local.get(BRIDGE_STORAGE_KEYS, (result) => {
      const provider = result.bridgeProvider || 'anthropic';
      const info = PROVIDER_INFO[provider] || PROVIDER_INFO.anthropic;
      apiKeyConfigured = isProviderConfigured(provider, result);
      const wrap = document.getElementById('aiToggleWrap');
      const checkbox = document.getElementById('aiEnhanced');
      if (!apiKeyConfigured) {
        wrap.classList.add('disabled');
        checkbox.disabled = true;
        wrap.title = provider === 'local'
          ? 'Set an Ollama server URL and model in Options to enable AI-enhanced extraction.'
          : `Set a ${info.label} API key in Options to enable AI-enhanced extraction.`;
      } else {
        wrap.classList.remove('disabled');
        checkbox.disabled = false;
        wrap.title = provider === 'local'
          ? 'Refine the extraction using your local Ollama model.'
          : `Refine the extraction using your ${info.label} API key.`;
      }
      resolve();
    });
  });
}

async function runAiRefine() {
  if (!apiKeyConfigured) return;
  const settings = await new Promise((resolve) => {
    chrome.storage.local.get(BRIDGE_STORAGE_KEYS, resolve);
  });
  const provider = settings.bridgeProvider || 'anthropic';
  const apiKey = provider === 'local' ? settings.bridgeApiKeyLocal : settings[PROVIDER_INFO[provider].keyField];
  const model = provider === 'local' ? settings.bridgeLocalModel : undefined;
  const baseUrl = provider === 'local' ? settings.bridgeLocalBaseUrl : undefined;

  const mode = document.getElementById('mode').value;
  syncEditsFromUI();
  const info = PROVIDER_INFO[provider] || PROVIDER_INFO.anthropic;
  const host = provider === 'local' ? baseUrl : info.host;
  showStatus(provider === 'local' ? `Refining with AI (this calls your local model at ${host})…` : `Refining with AI (this calls ${host} with your key)…`, 'info');
  try {
    bridgeContext = await refineBridgeContextWithAI(bridgeContext, rawBranchText, { provider, apiKey, model, baseUrl }, mode);
    renderSections();
    showStatus('AI-refined context ready. Review and edit below before exporting.', 'success');
  } catch (error) {
    console.error('AI refine failed:', error);
    showStatus(`AI refine failed: ${error.message}`, 'error');
    document.getElementById('aiEnhanced').checked = false;
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const params = new URLSearchParams(window.location.search);
  const source = params.get('source');

  chrome.storage.local.get(['bridgeDefaultMode'], (result) => {
    if (result.bridgeDefaultMode) document.getElementById('mode').value = result.bridgeDefaultMode;
  });

  await checkApiKey();

  try {
    if (source === 'project') {
      // Merged project bridge — browse.js already ran extraction per
      // conversation and stashed the merged context for this one-shot read.
      const stashed = await new Promise((resolve) => {
        chrome.storage.local.get(['pendingBridgeContext'], (result) => resolve(result.pendingBridgeContext));
      });
      chrome.storage.local.remove('pendingBridgeContext');
      if (!stashed) throw new Error('No pending project bridge context found. Please try again from the browse page.');
      bridgeContext = stashed;
      rawBranchText = '';
      document.getElementById('mode').value = bridgeContext.mode || document.getElementById('mode').value;
      renderSections();
      showStatus('Project bridge context loaded. Review and edit below before exporting.', 'success');
    } else {
      const orgId = params.get('orgId');
      const conversationId = params.get('conversationId');
      if (!orgId || !conversationId) throw new Error('Missing conversation reference. Open the Bridge from the popup or browse page.');

      showStatus('Fetching conversation…', 'info');
      const response = await sendMessageToClaudeTab('fetchConversationData', { orgId, conversationId });
      window.__ceRawConversation = response.data;
      rawBranchText = getBranchText(response.data);
      await runExtraction(document.getElementById('mode').value);

      // Multi-org accounts: the conversation may have been found under a
      // different org than the one we sent (see fetchConversationAnyOrg in
      // content.js). Remember the working org for next time.
      if (response.resolvedOrgId && response.resolvedOrgId !== orgId) {
        chrome.storage.sync.set({ organizationId: response.resolvedOrgId });
        showStatus('Context extracted (switched to a different organization for this conversation). Review and edit below before exporting.', 'success');
      }
    }
  } catch (error) {
    console.error('Bridge init failed:', error);
    showStatus(error.message, 'error');
  }

  document.getElementById('mode').addEventListener('change', async (e) => {
    if (window.__ceRawConversation) await runExtraction(e.target.value);
    else updatePreview();
  });

  document.getElementById('regenerate').addEventListener('click', async () => {
    if (window.__ceRawConversation) await runExtraction(document.getElementById('mode').value);
  });

  document.getElementById('aiEnhanced').addEventListener('change', (e) => {
    if (e.target.checked) runAiRefine();
  });

  // Re-render the preview live as the user edits any section.
  document.getElementById('sections').addEventListener('input', updatePreview);

  document.getElementById('copyMarkdown').addEventListener('click', async () => {
    syncEditsFromUI();
    const md = generateBridgeMarkdown(bridgeContext);
    try {
      await navigator.clipboard.writeText(md);
      showStatus('Markdown prompt copied to clipboard!', 'success');
    } catch (e) {
      showStatus('Copy failed — your browser may be blocking clipboard access.', 'error');
    }
  });

  document.getElementById('downloadMarkdown').addEventListener('click', () => {
    syncEditsFromUI();
    const md = generateBridgeMarkdown(bridgeContext);
    downloadFile(md, `claude-bridge-${safeFilenameBase()}.md`, 'text/markdown');
    showStatus('Markdown bridge downloaded!', 'success');
  });

  document.getElementById('downloadJson').addEventListener('click', () => {
    syncEditsFromUI();
    const json = generateBridgeJSON(bridgeContext);
    downloadFile(JSON.stringify(json, null, 2), `claude-bridge-${safeFilenameBase()}.json`, 'application/json');
    showStatus('JSON bridge downloaded!', 'success');
  });
});
