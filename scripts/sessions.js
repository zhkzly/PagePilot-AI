// Session persistence for FisherAI
// Stores conversation history keyed by URL in chrome.storage.local

const SESSIONS_KEY = 'fisherai_sessions';
const MAX_CONTEXT_TOKENS = 150000;
const CONTEXT_COMPRESSION_TRIGGER_TOKENS = 100000;
const DEFAULT_SESSION_GROUP = 'Default';
const PROTECTED_RECENT_USER_MESSAGES = 4;
const PROTECTED_RECENT_ASSISTANT_MESSAGES = 3;
const TOOL_COMPACT_MAX_CHARS = 1200;
const TOOL_MARKDOWN_PREVIEW_CHARS = 900;
const ASSISTANT_TRUNCATE_HEAD_CHARS = 900;
const ASSISTANT_TRUNCATE_TAIL_CHARS = 300;

/**
 * Lightweight token estimator (no external dependencies)
 * Accounts for Chinese chars (~1.5 tokens each) and English words (~0.7 tokens each)
 */
function estimateTokens(text) {
  if (!text) return 0;
  const chinese = (text.match(/[\u4e00-\u9fff]/g) || []).length;
  const english = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.ceil(chinese * 1.5 + english * 0.7 + text.length * 0.1);
}

function estimateMessageTokens(message) {
  if (!message) return 0;
  const content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content || '');
  return estimateTokens(content);
}

function createHistoryMeta(meta = {}, message = null) {
  const originalTokenEstimate = meta.originalTokenEstimate != null
    ? meta.originalTokenEstimate
    : estimateMessageTokens(message || { content: '' });

  return {
    originalRole: meta.originalRole || (message && message.role) || 'user',
    protected: Boolean(meta.protected),
    compressed: Boolean(meta.compressed),
    droppedFromContext: Boolean(meta.droppedFromContext),
    compressionType: meta.compressionType || null,
    compressionSource: meta.compressionSource || null,
    compactContent: typeof meta.compactContent === 'string' ? meta.compactContent : '',
    originalTokenEstimate,
    compactTokenEstimate: meta.compactTokenEstimate != null ? meta.compactTokenEstimate : 0,
    toolName: meta.toolName || null
  };
}

function ensureHistoryMessageMeta(message) {
  if (!message || typeof message !== 'object') {
    return message;
  }

  if (!message.meta || typeof message.meta !== 'object') {
    message.meta = createHistoryMeta({}, message);
  } else {
    message.meta = createHistoryMeta(message.meta, message);
  }

  return message;
}

function _normalizeTextForCompression(value) {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (!item) return '';
        if (typeof item === 'string') return item;
        if (typeof item.text === 'string') return item.text;
        if (item.type === 'text' && typeof item.text === 'string') return item.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (value && typeof value === 'object') {
    if (typeof value.text === 'string') {
      return value.text;
    }
    try {
      return JSON.stringify(value);
    } catch (error) {
      return '';
    }
  }
  return '';
}

function truncateMiddleText(text, headChars, tailChars, marker) {
  const raw = String(text || '');
  if (!raw) {
    return '';
  }
  if (raw.length <= headChars + tailChars + marker.length + 8) {
    return raw;
  }
  const head = raw.slice(0, headChars).trim();
  const tail = tailChars > 0 ? raw.slice(-tailChars).trim() : '';
  if (!tail) {
    return `${head}\n\n${marker}`;
  }
  return `${head}\n\n${marker}\n\n${tail}`;
}

function _safeObjectString(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value || '');
  }
}

function _extractToolNameFromMessage(message) {
  const metaToolName = message?.meta?.toolName;
  if (metaToolName) {
    return metaToolName;
  }
  const content = typeof message?.content === 'string' ? message.content : '';
  if (!content) {
    return '';
  }
  try {
    const parsed = JSON.parse(content);
    if (parsed?.name) return String(parsed.name);
  } catch (error) {
    // ignore
  }
  return '';
}

function compactToolMessage(message) {
  const raw = typeof message?.content === 'string' ? message.content : _safeObjectString(message?.content);
  if (!raw) {
    return '[TOOL_RESULT_EMPTY]';
  }

  let compactText = '';
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    parsed = null;
  }

  const toolName = _extractToolNameFromMessage(message) || 'tool';
  if (parsed && typeof parsed === 'object') {
    const lines = [`[TOOL:${toolName}]`];

    if (parsed.query) {
      lines.push(`query: ${parsed.query}`);
    }
    if (parsed.url) {
      lines.push(`url: ${parsed.url}`);
    }
    if (parsed.message && parsed.status === 'error') {
      lines.push(`status: error`);
      lines.push(`message: ${parsed.message}`);
      compactText = lines.join('\n');
    } else if (parsed.result && typeof parsed.result === 'object') {
      const result = parsed.result;
      if (result.title) {
        lines.push(`title: ${result.title}`);
      }
      if (result.sourceUrl) {
        lines.push(`source: ${result.sourceUrl}`);
      }
      if (result.requestedUrl) {
        lines.push(`requested: ${result.requestedUrl}`);
      }
      if (result.publishedTime) {
        lines.push(`published: ${result.publishedTime}`);
      }
      if (result.answerBox) {
        const answer = _safeObjectString(result.answerBox);
        lines.push(`answer: ${truncateMiddleText(answer, 320, 120, '[TOOL_SECTION_TRUNCATED]')}`);
      }
      if (Array.isArray(result.organicResults) && result.organicResults.length > 0) {
        const topResults = result.organicResults.slice(0, 3).map((item, index) => {
          const title = item?.title || '';
          const link = item?.link || '';
          const snippet = truncateMiddleText(item?.snippet || '', 180, 80, '[SNIPPET_TRUNCATED]');
          return `${index + 1}. ${title}\n${link}\n${snippet}`.trim();
        }).join('\n');
        if (topResults) {
          lines.push(`results:\n${topResults}`);
        }
      }
      if (result.markdown) {
        const preview = truncateMiddleText(
          String(result.markdown).replace(/\n{3,}/g, '\n\n'),
          TOOL_MARKDOWN_PREVIEW_CHARS,
          0,
          '[TOOL_MARKDOWN_TRUNCATED]'
        );
        lines.push(`preview:\n${preview}`);
      }
      compactText = lines.join('\n');
    }
  }

  if (!compactText) {
    compactText = `[TOOL:${toolName}]\n${truncateMiddleText(raw, TOOL_COMPACT_MAX_CHARS, 0, '[TOOL_RESULT_TRUNCATED]')}`;
  }

  message.meta.compactContent = truncateMiddleText(compactText, TOOL_COMPACT_MAX_CHARS, 0, '[TOOL_RESULT_TRUNCATED]');
  message.meta.compressed = true;
  message.meta.compressionType = 'tool_summary';
  message.meta.compressionSource = 'raw';
  message.meta.compactTokenEstimate = estimateTokens(message.meta.compactContent);
}

function compactAssistantMessage(message) {
  const rawText = _normalizeTextForCompression(message?.content);
  if (!rawText) {
    message.meta.compactContent = '';
  } else {
    message.meta.compactContent = truncateMiddleText(
      rawText,
      ASSISTANT_TRUNCATE_HEAD_CHARS,
      ASSISTANT_TRUNCATE_TAIL_CHARS,
      '[ASSISTANT_RESPONSE_TRUNCATED]'
    );
  }
  message.meta.compressed = true;
  message.meta.compressionType = 'assistant_truncate';
  message.meta.compressionSource = 'raw';
  message.meta.compactTokenEstimate = estimateTokens(message.meta.compactContent);
}

function _resolveToolNameByCallId(history, toolCallId, toolMessageIndex) {
  if (!toolCallId) {
    return '';
  }
  for (let i = toolMessageIndex - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) {
      continue;
    }
    const matched = msg.tool_calls.find((toolCall) => toolCall && toolCall.id === toolCallId);
    if (matched?.function?.name) {
      return matched.function.name;
    }
  }
  return '';
}

function prepareHistoryMeta(history) {
  if (!Array.isArray(history)) {
    return [];
  }

  history.forEach((message, index) => {
    ensureHistoryMessageMeta(message);
    message.meta.originalRole = message.role || message.meta.originalRole;
    message.meta.originalTokenEstimate = estimateMessageTokens(message);
    if (message.role === 'tool' && !message.meta.toolName) {
      message.meta.toolName = _resolveToolNameByCallId(history, message.tool_call_id, index) || message.meta.toolName;
    }
    message.meta.protected = false;
  });

  if (history[0]) {
    history[0].meta.protected = true;
  }

  if (history.length > 1) {
    const docMsg = history[1];
    const docContent = _normalizeTextForCompression(docMsg?.content);
    if (docMsg && docMsg.role === 'user' && estimateTokens(docContent) > 1000) {
      docMsg.meta.protected = true;
    }
  }

  let protectedUserCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'user') continue;
    if (protectedUserCount >= PROTECTED_RECENT_USER_MESSAGES) break;
    msg.meta.protected = true;
    protectedUserCount += 1;
  }

  let protectedAssistantCount = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) continue;
    if (protectedAssistantCount >= PROTECTED_RECENT_ASSISTANT_MESSAGES) break;
    msg.meta.protected = true;
    protectedAssistantCount += 1;
  }

  return history;
}

function _buildMessageForContext(message) {
  if (!message || !message.meta || message.meta.droppedFromContext) {
    return null;
  }

  if (message.meta.compressed && typeof message.meta.compactContent === 'string') {
    return {
      ...message,
      content: message.meta.compactContent
    };
  }

  return message;
}

function _estimateContextTokens(messages) {
  return messages.reduce((sum, message) => {
    if (!message) return sum;
    return sum + estimateMessageTokens(message);
  }, 0);
}

function _selectCompressionCandidate(history, role) {
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (!msg || msg.role !== role) continue;
    if (!msg.meta || msg.meta.protected || msg.meta.compressed || msg.meta.droppedFromContext) continue;
    if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) continue;
    return msg;
  }
  return null;
}

function _selectDropCandidate(history, role) {
  for (let i = 0; i < history.length; i++) {
    const msg = history[i];
    if (!msg || msg.role !== role) continue;
    if (!msg.meta || msg.meta.protected || !msg.meta.compressed || msg.meta.droppedFromContext) continue;
    if (role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) continue;
    return msg;
  }
  return null;
}

function buildContextFromHistory(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return [];
  }

  prepareHistoryMeta(history);

  let contextMessages = history
    .map(_buildMessageForContext)
    .filter(Boolean);

  let totalTokens = _estimateContextTokens(contextMessages);
  if (totalTokens <= CONTEXT_COMPRESSION_TRIGGER_TOKENS) {
    return contextMessages;
  }

  while (totalTokens > CONTEXT_COMPRESSION_TRIGGER_TOKENS) {
    const toolCandidate = _selectCompressionCandidate(history, 'tool');
    if (toolCandidate) {
      compactToolMessage(toolCandidate);
    } else {
      const assistantCandidate = _selectCompressionCandidate(history, 'assistant');
      if (assistantCandidate) {
        compactAssistantMessage(assistantCandidate);
      } else {
        const dropToolCandidate = _selectDropCandidate(history, 'tool');
        if (dropToolCandidate) {
          dropToolCandidate.meta.droppedFromContext = true;
        } else {
          const dropAssistantCandidate = _selectDropCandidate(history, 'assistant');
          if (dropAssistantCandidate) {
            dropAssistantCandidate.meta.droppedFromContext = true;
          } else {
            break;
          }
        }
      }
    }

    contextMessages = history
      .map(_buildMessageForContext)
      .filter(Boolean);
    totalTokens = _estimateContextTokens(contextMessages);
  }

  return contextMessages;
}

function _convertOpenAIContentToGeminiParts(content) {
  const parts = [];
  if (typeof content === 'string') {
    if (content) {
      parts.push({ text: content });
    }
    return parts;
  }

  if (!Array.isArray(content)) {
    return parts;
  }

  content.forEach((item) => {
    if (!item) return;
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push({ text: item.text });
      return;
    }
    if (item.type === 'image_url' && item.image_url?.url) {
      try {
        const parsed = parseBase64Image(item.image_url.url);
        parts.push({
          inline_data: {
            mime_type: parsed.mimeType,
            data: parsed.data
          }
        });
      } catch (error) {
        // ignore invalid image payloads in history rebuild
      }
    }
  });

  return parts;
}

function buildGeminiContextFromOpenAIHistory(history) {
  const contextMessages = buildContextFromHistory(history);
  const geminiContents = [];

  contextMessages.forEach((message, index) => {
    if (!message || message.role === 'system') {
      return;
    }

    if (message.role === 'user') {
      geminiContents.push({
        role: 'user',
        parts: _convertOpenAIContentToGeminiParts(message.content)
      });
      return;
    }

    if (message.role === 'assistant') {
      if (Array.isArray(message.tool_calls) && message.tool_calls.length > 0) {
        const parts = message.tool_calls
          .map((toolCall) => {
            if (!toolCall?.function?.name) return null;
            let args = {};
            try {
              args = JSON.parse(toolCall.function.arguments || '{}');
            } catch (error) {
              args = {};
            }
            return {
              functionCall: {
                name: toolCall.function.name,
                args
              }
            };
          })
          .filter(Boolean);
        if (parts.length > 0) {
          geminiContents.push({ role: 'model', parts });
        }
      } else {
        geminiContents.push({
          role: 'model',
          parts: [{ text: _normalizeTextForCompression(message.content) }]
        });
      }
      return;
    }

    if (message.role === 'tool') {
      const toolName = message.meta?.toolName || _resolveToolNameByCallId(contextMessages, message.tool_call_id, index) || 'tool';
      geminiContents.push({
        role: 'function',
        parts: [
          {
            functionResponse: {
              name: toolName,
              response: {
                name: toolName,
                content: _normalizeTextForCompression(message.content)
              }
            }
          }
        ]
      });
    }
  });

  return geminiContents;
}

/**
 * Build a token-safe history:
 * 1. history[0] (system prompt) always kept
 * 2. history[1] (document message, if large) always kept – protects full document context
 * 3. Remaining conversation messages kept from newest, up to MAX_CONTEXT_TOKENS
 * @param {Array} history - OpenAI-format dialogue history
 * @returns {Array} Truncated history safe for 200K context models
 */
function buildSafeHistory(history) {
  return buildContextFromHistory(history);
}

/**
 * Get all sessions, sorted by updatedAt descending
 * @returns {Promise<Array>}
 */
async function getAllSessions() {
  return new Promise(resolve => {
    chrome.storage.local.get(SESSIONS_KEY, result => {
      const sessions = (result[SESSIONS_KEY] || []).map((session) => ({
        ...session,
        group: _normalizeSessionGroup(session.group)
      }));
      sessions.sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(sessions);
    });
  });
}

/**
 * Find a session by exact URL match
 * @param {string} url
 * @returns {Promise<Object|null>}
 */
async function getSessionByUrl(url) {
  const sessions = await getAllSessions();
  return sessions.find(s => s.url === url) || null;
}

/**
 * Find a session by ID
 * @param {string} id
 * @returns {Promise<Object|null>}
 */
async function getSessionById(id) {
  if (!id) return null;
  const sessions = await getAllSessions();
  return sessions.find(s => s.id === id) || null;
}

/**
 * Get all sessions for a URL
 * @param {string} url
 * @returns {Promise<Array>}
 */
async function getSessionsByUrl(url) {
  if (!url) return [];
  const sessions = await getAllSessions();
  return sessions.filter(s => s.url === url);
}

/**
 * Save (create or update) the session for a given URL
 * @param {string} url - Page URL (session key)
 * @param {string} title - Page title
 * @param {Array} history - OpenAI-format dialogue history
 * @param {Array} geminiHistory - Gemini-format dialogue history
 * @param {string} docCtx - Raw document content (for session resume)
 * @param {string|null} sessionId - Session ID; when provided, update this exact session
 * @returns {Promise<string|null>} persisted session id
 */
async function saveCurrentSession(url, title, history, geminiHistory, docCtx, sessionId = null) {
  if (!url) return null;
  let sessions = await getAllSessions();
  const existingIdx = sessionId ? sessions.findIndex(s => s.id === sessionId) : -1;
  const now = Date.now();

  if (existingIdx >= 0) {
    const existing = sessions[existingIdx];
    // Only overwrite history when the new one has meaningful content (length > 1)
    const safeHistory = (history && history.length > 1) ? history : existing.history;
    const safeGeminiHistory = (geminiHistory && geminiHistory.length > 0) ? geminiHistory : existing.geminiHistory;
    sessions[existingIdx] = {
      ...existing,
      title: title || existing.title,
      history: safeHistory,
      geminiHistory: safeGeminiHistory,
      group: _normalizeSessionGroup(existing.group),
      documentContext: docCtx !== undefined ? docCtx : (existing.documentContext || ''),
      updatedAt: now
    };
    sessionId = sessions[existingIdx].id;
  } else {
    const newSessionId = _generateSessionId();
    sessions.unshift({
      id: newSessionId,
      url,
      title: title || url,
      name: null,
      group: DEFAULT_SESSION_GROUP,
      history: history || [],
      geminiHistory: geminiHistory || [],
      documentContext: docCtx || '',
      createdAt: now,
      updatedAt: now
    });
    sessionId = newSessionId;
  }

  sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  await _persistSessions(sessions);
  return sessionId;
}

/**
 * Rename a session (user-provided name; null to clear)
 * @param {string} id - Session ID
 * @param {string|null} name - New name
 */
async function renameSession(id, name) {
  const sessions = await getAllSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx >= 0) {
    sessions[idx].name = name || null;
    await _persistSessions(sessions);
  }
}

/**
 * Move a session into another group
 * @param {string} id - Session ID
 * @param {string} groupName - Target group name
 */
async function setSessionGroup(id, groupName) {
  const sessions = await getAllSessions();
  const idx = sessions.findIndex(s => s.id === id);
  if (idx >= 0) {
    sessions[idx].group = _normalizeSessionGroup(groupName);
    await _persistSessions(sessions);
  }
}

async function renameSessionGroup(oldGroupName, newGroupName) {
  const sessions = await getAllSessions();
  const from = _normalizeSessionGroup(oldGroupName);
  const to = _normalizeSessionGroup(newGroupName);
  if (!from || !to || from === to) {
    return;
  }

  let changed = false;
  sessions.forEach((session) => {
    if (_normalizeSessionGroup(session.group) === from) {
      session.group = to;
      changed = true;
    }
  });

  if (changed) {
    await _persistSessions(sessions);
  }
}

/**
 * Delete a session by ID
 * @param {string} id - Session ID
 */
async function deleteSession(id) {
  let sessions = await getAllSessions();
  sessions = sessions.filter(s => s.id !== id);
  await _persistSessions(sessions);
}

/**
 * Format a timestamp as a short relative-time string
 * @param {number} ts - Unix timestamp (ms)
 * @returns {string}
 */
function formatSessionTime(ts) {
  if (!ts) return '';
  const diff = Date.now() - ts;
  const i18n = window._sessionI18n || {};
  if (diff < 60000) return i18n.just_now || 'Just now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h';
  return Math.floor(diff / 86400000) + 'd';
}

// ---- Private helpers ----

function _generateSessionId() {
  return 'sess_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function _normalizeSessionGroup(group) {
  const trimmed = typeof group === 'string' ? group.trim() : '';
  return trimmed || DEFAULT_SESSION_GROUP;
}

async function _persistSessions(sessions) {
  return new Promise(resolve => {
    chrome.storage.local.set({ [SESSIONS_KEY]: sessions }, () => {
      if (chrome.runtime.lastError) {
        const errMsg = chrome.runtime.lastError.message || '';
        if (errMsg.toLowerCase().includes('quota')) {
          // LRU eviction: drop oldest 25% and retry
          const toRemove = Math.max(1, Math.floor(sessions.length / 4));
          const pruned = sessions.slice(0, sessions.length - toRemove);
          chrome.storage.local.set({ [SESSIONS_KEY]: pruned }, resolve);
        } else {
          console.error('Session persist error:', errMsg);
          resolve();
        }
      } else {
        resolve();
      }
    });
  });
}
