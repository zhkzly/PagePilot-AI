/**
 * 初始化国际化支持
 */
async function initI18n() {
  // 初始化页面的国际化
  const currentLang = await window.i18n.init();
  
  // 更新动态文本（那些不是通过data-i18n属性设置的文本）
  updateDynamicTexts(currentLang);
}

/**
 * 应用保存的外观模式
 */
function applyAppearanceMode() {
  chrome.storage.sync.get('appearance', function(result) {
    const appearance = result.appearance || 'dark'; // 默认深色模式
    
    if (appearance === 'light') {
      document.querySelector('.my-extension-resultPage').classList.add('light-mode');
    } else {
      document.querySelector('.my-extension-resultPage').classList.remove('light-mode');
    }
  });
}

/**
 * 打开设置页面
 */
function openSettingsPage() {
  chrome.runtime.sendMessage({ action: "openSettings" });
}

/**
 * 更新动态文本（那些不通过data-i18n属性设置的文本）
 */
async function updateDynamicTexts(lang) {
  // 获取常量文本的翻译
  const messages = await window.i18n.getMessages([
    'default_tips', 
    'shortcut_summary', 
    'shortcut_dict', 
    'shortcut_translation', 
    'shortcut_polish', 
    'shortcut_code_explain', 
    'shortcut_image2text',
    'free_models',
    'custom_config_models',
    'ollama_local_models',
    'model_parameters'
  ], lang);
  
  // 更新常量
  DEFAULT_TIPS = messages.default_tips;
  SHORTCUT_SUMMAY = messages.shortcut_summary;
  SHORTCUT_DICTION = messages.shortcut_dict;
  SHORTCUT_TRANSLATION = messages.shortcut_translation;
  SHORTCUT_POLISH = messages.shortcut_polish;
  SHORTCUT_CODE_EXPLAIN = messages.shortcut_code_explain;
  SHORTCUT_IMAGE2TEXT = messages.shortcut_image2text;
  
  // 更新模型选择下拉框的 optgroup 标签
  const modelSelect = document.getElementById('model-selection');
  if (modelSelect) {
    const optgroups = modelSelect.querySelectorAll('optgroup');
    for (const optgroup of optgroups) {
      const i18nKey = optgroup.getAttribute('data-i18n');
      if (i18nKey && messages[i18nKey]) {
        optgroup.label = messages[i18nKey];
      }
    }
  }
  
  // 更新模型参数标题
  const modelParamsTitle = document.querySelector('#params-label svg title');
  if (modelParamsTitle && messages.model_parameters) {
    modelParamsTitle.textContent = messages.model_parameters;
  }
  
  // 更新其他动态内容
  // ...
}

/**
 * 判断是否设置api key
 * @returns
 */
async function getProviderBaseUrlAndApiKey(provider) {
  const providerConfig = Array.isArray(DEFAULT_LLM_URLS)
    ? DEFAULT_LLM_URLS.find(item => item.key === provider)
    : null;

  if (!providerConfig) {
    return { baseUrl: null, apiKey: null };
  }

  const storedConfig = await new Promise((resolve) => {
    chrome.storage.sync.get(provider, function(result) {
      if (chrome.runtime.lastError) {
        console.error('读取 provider 配置失败:', chrome.runtime.lastError);
        resolve(null);
        return;
      }
      resolve(result ? result[provider] : null);
    });
  });

  const domain = storedConfig?.baseUrl || providerConfig.baseUrl || null;
  const apiKey = storedConfig?.apiKey || '';

  return {
    baseUrl: domain ? `${domain}${providerConfig.apiPath}` : null,
    apiKey
  };
}

async function verifyApiKeyConfigured(provider) {
  const {baseUrl, apiKey} = await getProviderBaseUrlAndApiKey(provider);

  if(provider.includes(PROVIDER_FISHERAI) || provider.includes(PROVIDER_OLLAMA)) {
    return true;
  }
  if(baseUrl == null || apiKey == null || apiKey === '') {
    // 隐藏初始推荐内容
    const sloganDiv = document.querySelector('.my-extension-slogan');
    sloganDiv.style.display = 'none';
    const featureDiv = document.querySelector('.feature-container');
    featureDiv.style.display = 'none';
    // 初始化对话内容 
    var contentDiv = document.querySelector('.chat-content');
    contentDiv.innerHTML = DEFAULT_TIPS;
    
    return false;
  }

  return true;
}

/**
 * 隐藏初始推荐内容
 */
function hideRecommandContent() {
  const sloganDiv = document.querySelector('.my-extension-slogan');
  if (sloganDiv) {
    sloganDiv.style.display = 'none';
  }
  const featureDiv = document.querySelector('.feature-container');
  if (featureDiv) {
    featureDiv.style.display = 'none';
  }
}

/**
 * 展示初始推荐内容
 */
function showRecommandContent() {
  const sloganDiv = document.querySelector('.my-extension-slogan');
  if (sloganDiv) {
    sloganDiv.style.display = '';
  }
  const featureDiv = document.querySelector('.feature-container');
  if (featureDiv) {
    featureDiv.style.display = '';
  }
}

/**
 * 定义清空并加载内容的函数
 * @param {string} docContext - 原始文档内容，用于会话持久化（可选）
 */
async function clearAndGenerate(model, provider, inputText, base64Images, docContext) {
  // 保存当前会话再切换（使用旧的 currentSessionUrl）
  await _autoSaveCurrentSession();

  // 更新 currentSessionUrl 为当前活动 tab 的 URL
  try {
    const tab = await _getCurrentActiveTab();
    currentSessionUrl = tab ? tab.url : null;
  } catch (e) {
    currentSessionUrl = null;
  }
  // 新任务创建新会话，避免覆盖旧会话
  currentSessionId = null;

  // 重置对话历史
  initChatHistory();

  // 设置新的文档上下文
  currentDocumentContext = (docContext !== undefined && docContext !== null) ? docContext : '';

  // 隐藏初始推荐内容
  hideRecommandContent();

  // clean
  const contentDiv = document.querySelector('.chat-content');
  contentDiv.innerHTML = '';
  updateSessionBar();

  // generate
  await chatLLMAndUIUpdate(model, provider, inputText, base64Images);
}

/**
 * 调用模型 & 更新ui
 * @param {string} model 
 * @param {string} provider 
 * @param {string} inputText 
 * @param {Array} base64Images 
 */
async function chatLLMAndUIUpdate(model, provider, inputText, base64Images) {
  // loading
  displayLoading();

  // submit & generating button
  hideSubmitBtnAndShowGenBtn();
  
  // 创建或获取AI回答div
  const contentDiv = document.querySelector('.chat-content');
  let aiMessageDiv = contentDiv.lastElementChild;
  if (!aiMessageDiv || !aiMessageDiv.classList.contains('ai-message')) {
    aiMessageDiv = document.createElement('div');
    aiMessageDiv.className = 'ai-message';
    contentDiv.appendChild(aiMessageDiv);
  } else {
    aiMessageDiv.innerHTML = ''; // Clear existing content if regenerating
  }
    
  try {
    const completeText = await chatWithLLM(model, provider, inputText, base64Images, CHAT_TYPE);
    createCopyButton(completeText);
    // 异步保存会话（不阻塞 UI）
    _autoSaveCurrentSession()
      .then(() => _maybeAutoGenerateSessionName(model, provider))
      .catch(err => console.debug('Session save error:', err));
  } catch (error) {
    hiddenLoadding();
    console.error('请求异常:', error);
    displayErrorMessage(error, {
      context: '生成回答',
      defaultMessage: '暂时无法生成回答，请稍后再试或检查模型配置。'
    });
  } finally {
    // submit & generating button
    showSubmitBtnAndHideGenBtn();
  }
}

/**
 * 生成复制按钮
 * @param {string} completeText 
 */
function createCopyButton(completeText) {
  const contentDiv = document.querySelector('.chat-content');
  const lastDiv = contentDiv ? contentDiv.lastElementChild : null;
  if (!lastDiv) {
    return;
  }

  const copyActions = document.createElement('div');
  copyActions.className = 'copy-actions';

  const copyTextButton = document.createElement('button');
  copyTextButton.type = 'button';
  copyTextButton.className = 'copy-action-btn';
  copyTextButton.textContent = 'Copy TXT';

  const copyMarkdownButton = document.createElement('button');
  copyMarkdownButton.type = 'button';
  copyMarkdownButton.className = 'copy-action-btn';
  copyMarkdownButton.textContent = 'Copy MD';

  const copyWpsButton = document.createElement('button');
  copyWpsButton.type = 'button';
  copyWpsButton.className = 'copy-action-btn';
  copyWpsButton.textContent = 'Copy WPS';

  // 使用已有 i18n 的 copy 文案，避免硬编码多语言文本
  if (window.i18n && typeof window.i18n.getCurrentLanguage === 'function' && typeof window.i18n.getMessages === 'function') {
    window.i18n.getCurrentLanguage()
      .then(lang => window.i18n.getMessages(['copy'], lang))
      .then(messages => {
        const copyText = messages.copy || 'Copy';
        copyTextButton.textContent = `${copyText} TXT`;
        copyMarkdownButton.textContent = `${copyText} MD`;
        copyWpsButton.textContent = `${copyText} WPS`;
      })
      .catch(() => {
        // 使用默认英文文案
      });
  }

  copyTextButton.addEventListener('click', function() {
    const plainText = convertMarkdownToPlainText(completeText);
    copyTextToClipboard(plainText, copyTextButton);
  });

  copyMarkdownButton.addEventListener('click', function() {
    copyTextToClipboard(completeText, copyMarkdownButton);
  });

  copyWpsButton.addEventListener('click', async function() {
    await copyForWpsDocument(lastDiv, copyWpsButton);
  });

  copyActions.appendChild(copyTextButton);
  copyActions.appendChild(copyMarkdownButton);
  copyActions.appendChild(copyWpsButton);
  lastDiv.appendChild(copyActions);
}

function convertMarkdownToPlainText(markdownText) {
  if (!markdownText) {
    return '';
  }
  const temp = document.createElement('div');
  temp.innerHTML = marked.parse(markdownText);
  return (temp.textContent || temp.innerText || '').trim();
}

function copyTextToClipboard(text, button) {
  navigator.clipboard.writeText(text).then(() => {
    markCopySuccess(button);
  }).catch(err => {
    console.error('复制失败:', err);
  });
}

function markCopySuccess(button) {
  const originalLabel = button?.dataset?.originalLabel || button.textContent;
  button.textContent = '✓';
  button.classList.add('copied');
  setTimeout(() => {
    button.textContent = originalLabel;
    button.classList.remove('copied');
  }, 1200);
}

function markCopyFailure(button) {
  const originalLabel = button?.dataset?.originalLabel || button.textContent;
  button.textContent = '!';
  button.classList.remove('copied');
  setTimeout(() => {
    button.textContent = originalLabel;
  }, 1500);
}

function markCopyInProgress(button, inProgress) {
  if (!button) {
    return;
  }
  if (inProgress) {
    button.dataset.originalLabel = button.textContent;
    button.textContent = '...';
    button.disabled = true;
    button.classList.add('copying');
    return;
  }
  button.disabled = false;
  button.classList.remove('copying');
  if (button.textContent === '...' && button.dataset.originalLabel) {
    button.textContent = button.dataset.originalLabel;
  }
}

function withTimeout(promiseLike, timeoutMs, timeoutMessage) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(timeoutMessage || 'Operation timed out'));
    }, timeoutMs);

    Promise.resolve(promiseLike)
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function pickCopySourceElement(messageElement) {
  if (!messageElement) {
    return null;
  }
  return messageElement.querySelector('.regular-content') || messageElement;
}

function openWpsPreviewWindow() {
  try {
    const previewWindow = window.open('about:blank', '_blank');
    if (!previewWindow || previewWindow.closed) {
      return null;
    }
    previewWindow.document.open();
    previewWindow.document.write(`<!doctype html>
<html>
<head><meta charset="utf-8"><title></title></head>
<body style="margin:0;background:#fff;"></body>
</html>`);
    previewWindow.document.close();
    return previewWindow;
  } catch (error) {
    return null;
  }
}

async function copyForWpsDocument(messageElement, button) {
  if (button && button.dataset.copying === '1') {
    return;
  }

  const sourceElement = pickCopySourceElement(messageElement);
  if (!sourceElement) {
    return;
  }

  if (button) {
    button.dataset.copying = '1';
    markCopyInProgress(button, true);
  }

  const clone = sourceElement.cloneNode(true);
  clone.querySelectorAll('.copy-actions,.thinking-block,.edit-message-btn').forEach(el => el.remove());

  const staging = document.createElement('div');
  staging.style.position = 'fixed';
  staging.style.left = '0';
  staging.style.top = '0';
  staging.style.width = `${Math.max(sourceElement.clientWidth, 320)}px`;
  staging.style.opacity = '1';
  staging.style.pointerEvents = 'none';
  staging.style.zIndex = '-9999';
  staging.style.background = '#ffffff';
  staging.style.color = '#111827';
  staging.setAttribute('tabindex', '-1');
  staging.appendChild(clone);
  document.body.appendChild(staging);

  try {
    // Some replies can be restored as raw markdown text; render to HTML before copy.
    maybeRenderRawMarkdownForWps(clone);

    // Force dark-mode text to dark color for white-background rendering
    clone.querySelectorAll('.katex, .katex-html, .katex-display').forEach(el => {
      el.style.color = '#111827';
    });

    prepareFormulaNodesForWpsCopy(clone);

    // Fallback for residual latex-like text when math rendering doesn't trigger.
    if (clone.querySelectorAll('.katex').length === 0) {
      normalizeLatexCommandsToUnicode(clone);
    }

    // Apply inline styles so WPS/Word can render them (Chrome strips <style> blocks)
    inlineStylesForWps(clone);

    const htmlFragment = buildWpsClipboardFragment(clone);
    const htmlDoc = buildWpsClipboardDocument(clone);
    const plainText = (clone.textContent || clone.innerText || '').trim();

    // Primary: direct rich-text copy from HTML (better WPS compatibility).
    try {
      copyRichTextViaExecCommand(htmlFragment);
      markCopySuccess(button);
      return;
    } catch (directError) {
      console.warn('execCommand rich-text copy failed, fallback to Clipboard API:', directError);
    }

    // Secondary: Clipboard API with both text/html and text/plain
    const htmlBlob = new Blob([htmlDoc], { type: 'text/html' });
    const textBlob = new Blob([plainText], { type: 'text/plain' });
    await withTimeout(navigator.clipboard.write([
      new ClipboardItem({
        'text/html': htmlBlob,
        'text/plain': textBlob
      })
    ]), 3000, 'clipboard.write timeout');
    markCopySuccess(button);
  } catch (error) {
    console.warn('Clipboard copy failed, trying preview fallback:', error);
    // Last fallback: open preview window for manual copy
    try {
      const previewWindow = openWpsPreviewWindow();
      if (previewWindow && !previewWindow.closed) {
        const htmlDoc = buildWpsClipboardDocument(clone);
        previewWindow.document.open();
        previewWindow.document.write(htmlDoc);
        previewWindow.document.close();
        previewWindow.focus();
        markCopySuccess(button);
      } else {
        markCopyFailure(button);
      }
    } catch (_) {
      markCopyFailure(button);
    }
  } finally {
    staging.remove();
    if (button) {
      delete button.dataset.copying;
      markCopyInProgress(button, false);
      delete button.dataset.originalLabel;
    }
  }
}

function maybeRenderRawMarkdownForWps(rootElement) {
  if (!rootElement || typeof marked === 'undefined' || typeof marked.parse !== 'function') {
    return;
  }

  const hasStructuredHtml = !!rootElement.querySelector(
    'h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,code,pre,strong,em,table'
  );
  if (hasStructuredHtml) {
    return;
  }

  let raw = (rootElement.textContent || '').trim();
  if (!raw) {
    return;
  }

  const markdownHints =
    /(^|\n)\s*[-*+]\s+/.test(raw) ||
    /(^|\n)\s*\d+\.\s+/.test(raw) ||
    /\*\*[^*]+\*\*/.test(raw) ||
    /`[^`]+`/.test(raw) ||
    /(^|\n)#{1,6}\s+/.test(raw);

  if (!markdownHints) {
    return;
  }

  try {
    // tolerate model outputs like "** RAE **" by tightening inner spaces
    raw = raw.replace(/\*\*\s+([^*]+?)\s+\*\*/g, '**$1**');
    rootElement.innerHTML = marked.parse(raw);
  } catch (error) {
    console.warn('[FisherAI] markdown normalization failed:', error);
  }
}

function normalizeLatexCommandsToUnicode(rootElement) {
  if (!rootElement) {
    return;
  }

  const replacements = [
    [/\\alpha/g, 'α'],
    [/\\beta/g, 'β'],
    [/\\gamma/g, 'γ'],
    [/\\delta/g, 'δ'],
    [/\\epsilon/g, 'ϵ'],
    [/\\theta/g, 'θ'],
    [/\\lambda/g, 'λ'],
    [/\\mu/g, 'μ'],
    [/\\pi/g, 'π'],
    [/\\sigma/g, 'σ'],
    [/\\tau/g, 'τ'],
    [/\\omega/g, 'ω'],
    [/\\nabla/g, '∇'],
    [/\\partial/g, '∂'],
    [/\\sum/g, '∑'],
    [/\\prod/g, '∏'],
    [/\\int/g, '∫'],
    [/\\in/g, '∈'],
    [/\\notin/g, '∉'],
    [/\\mid/g, '|'],
    [/\\rightarrow/g, '→'],
    [/\\leftarrow/g, '←'],
    [/\\Rightarrow/g, '⇒'],
    [/\\Leftarrow/g, '⇐'],
    [/\\leftrightarrow/g, '↔'],
    [/\\Leftrightarrow/g, '⇔'],
    [/\\geq/g, '≥'],
    [/\\leq/g, '≤'],
    [/\\neq/g, '≠'],
    [/\\approx/g, '≈'],
    [/\\times/g, '×'],
    [/\\cdot/g, '·'],
    [/\\pm/g, '±'],
    [/\\infty/g, '∞'],
    [/\\%/g, '%']
  ];

  const walker = document.createTreeWalker(
    rootElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!node || !node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest('code, pre, script, style, .katex, .katex-display')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => {
    let text = node.nodeValue;
    if (!text || !text.includes('\\')) {
      return;
    }

    // Strip common layout wrappers first.
    text = text
      .replace(/\\left/g, '')
      .replace(/\\right/g, '')
      .replace(/\\,/g, ' ')
      .replace(/\\;/g, ' ')
      .replace(/\\!/g, '');

    // Convert common TeX containers to readable text.
    text = text
      .replace(/\\text\{([^{}]*)\}/g, '$1')
      .replace(/\\(?:mathbb|mathbf|mathrm|operatorname)\{([^{}]*)\}/g, '$1')
      .replace(/\\frac\{([^{}]{1,80})\}\{([^{}]{1,80})\}/g, '($1)/($2)')
      .replace(/\\sqrt\{([^{}]{1,80})\}/g, '√($1)')
      .replace(/_\{([^{}]{1,80})\}/g, '_$1')
      .replace(/\^\{([^{}]{1,80})\}/g, '^$1')
      .replace(/\\\{/g, '{')
      .replace(/\\\}/g, '}');

    // Greedy fallback for nested \frac forms (bounded passes).
    for (let i = 0; i < 6; i++) {
      const replaced = text.replace(/\\frac\{([^{}]{1,120})\}\{([^{}]{1,120})\}/g, '($1)/($2)');
      if (replaced === text) break;
      text = replaced;
    }

    let changed = false;
    replacements.forEach(([pattern, value]) => {
      if (pattern.test(text)) {
        text = text.replace(pattern, value);
        changed = true;
      }
    });
    if (changed) {
      node.nodeValue = text;
    }
  });
}

function prepareFormulaNodesForWpsCopy(rootElement) {
  if (!rootElement) {
    return;
  }

  const existingKatex = rootElement.querySelector('.katex');
  if (existingKatex) {
    return;
  }

  const rawText = (rootElement.textContent || '').trim();
  if (!rawText) {
    return;
  }

  // Guardrail: skip expensive formula scanning on extremely long prose.
  if (rawText.length > 30000) {
    return;
  }

  const hasLatexHints = /\\[A-Za-z]+|[_^]\{[^}\n]{1,80}\}|\$\$|\$[^$\n]+\$/.test(rawText);
  if (!hasLatexHints) {
    return;
  }

  // Use bounded loose promotion for better coverage on markdown-restored raw TeX.
  const heavy = rawText.length > 12000;
  renderLatexForWpsCopy(rootElement, {
    enableLoosePromotion: true,
    looseMaxNodes: heavy ? 50 : 160,
    looseMaxChars: heavy ? 12000 : 26000
  });

  // Secondary fallback for shorter text where direct katex rendering helps.
  if (rawText.length <= 8000) {
    convertLooseFormulaTextToKatex(rootElement);
  }
}

function convertLooseFormulaTextToKatex(rootElement) {
  if (!rootElement || typeof katex === 'undefined' || typeof katex.render !== 'function') {
    return;
  }

  const walker = document.createTreeWalker(
    rootElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!node || !node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest('code, pre, script, style, .katex')) {
          return NodeFilter.FILTER_REJECT;
        }
        const text = node.nodeValue;
        if (!/[\\_^=~]/.test(text)) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  while (walker.nextNode()) {
    textNodes.push(walker.currentNode);
  }

  textNodes.forEach((node) => {
    const text = node.nodeValue;
    const fragments = splitTextWithFormulaFragments(text);
    if (!fragments.some((part) => part.type === 'formula')) {
      return;
    }

    const fragment = document.createDocumentFragment();
    fragments.forEach((part) => {
      if (part.type === 'text') {
        fragment.appendChild(document.createTextNode(part.value));
        return;
      }

      const tex = part.value.trim();
      if (!tex) {
        return;
      }

      const host = document.createElement('span');
      try {
        const displayMode = shouldUseDisplayFormula(tex, part.contextBefore, part.contextAfter);
        katex.render(tex, host, {
          throwOnError: false,
          displayMode
        });
        fragment.appendChild(host);
      } catch (error) {
        fragment.appendChild(document.createTextNode(part.value));
      }
    });

    if (node.parentNode) {
      node.parentNode.replaceChild(fragment, node);
    }
  });
}

function splitTextWithFormulaFragments(text) {
  const ranges = collectFormulaRanges(text);
  if (!ranges.length) {
    return [{ type: 'text', value: text }];
  }

  const parts = [];
  let cursor = 0;
  ranges.forEach((range) => {
    if (range.start > cursor) {
      parts.push({ type: 'text', value: text.slice(cursor, range.start) });
    }
    parts.push({
      type: 'formula',
      value: text.slice(range.start, range.end),
      contextBefore: text.slice(Math.max(0, range.start - 8), range.start),
      contextAfter: text.slice(range.end, Math.min(text.length, range.end + 8))
    });
    cursor = range.end;
  });
  if (cursor < text.length) {
    parts.push({ type: 'text', value: text.slice(cursor) });
  }
  return parts;
}

function collectFormulaRanges(text) {
  const candidates = [];

  const commandDriven = /\\[A-Za-z]+(?:\s*\{[^{}]*\}|\s*\\[A-Za-z]+|\s*[_^]\{?[^{}\s]+\}?|\s*[A-Za-z0-9()+\-*/=.,{}\[\]\\~|]+)*/g;
  const scriptDriven = /[A-Za-z](?:\s*[_^]\{?[^{}\s]+\}?)+(?:\s*[~+=\-*/]\s*[A-Za-z0-9\\{}_^().,+\-*/\s|]+)?/g;

  const collect = (regex) => {
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = match[0];
      if (!isLikelyFormulaFragment(value.trim())) {
        continue;
      }
      candidates.push({
        start: match.index,
        end: match.index + value.length
      });
    }
  };

  collect(commandDriven);
  collect(scriptDriven);

  if (!candidates.length) {
    return [];
  }

  candidates.sort((a, b) => a.start - b.start || b.end - a.end);

  const merged = [];
  candidates.forEach((item) => {
    const prev = merged[merged.length - 1];
    if (!prev || item.start > prev.end) {
      merged.push(item);
      return;
    }
    prev.end = Math.max(prev.end, item.end);
  });

  return merged;
}

function shouldUseDisplayFormula(tex, contextBefore, contextAfter) {
  const before = (contextBefore || '').trim();
  const after = (contextAfter || '').trim();
  // Default to inline mode for loose formulas — only use display when clearly standalone
  if (!before && !after) {
    return false;
  }
  // Display mode only when preceded by a colon and followed by nothing or punctuation
  return /^[：:]*$/.test(before) && (!after || /^[，。；;,. ]+$/.test(after));
}

function renderLatexForWpsCopy(rootElement, options = {}) {
  if (!rootElement || typeof renderMathInElement !== 'function') {
    return;
  }
  const enableLoosePromotion = options.enableLoosePromotion === true;

  // First pass: standard delimiters.
  renderMathInElement(rootElement, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false },
      { left: '\\(', right: '\\)', display: false },
      { left: '\\[', right: '\\]', display: true }
    ],
    throwOnError: false
  });

  if (!enableLoosePromotion) {
    return;
  }

  // Second pass: try to promote plain LaTeX fragments like "\Delta \text{MI} = -0.23"
  // into $...$ so KaTeX can parse them.
  promoteLooseLatexText(rootElement, {
    maxNodes: Number.isFinite(options.looseMaxNodes) ? options.looseMaxNodes : 120,
    maxChars: Number.isFinite(options.looseMaxChars) ? options.looseMaxChars : 22000
  });
  renderMathInElement(rootElement, {
    delimiters: [
      { left: '$$', right: '$$', display: true },
      { left: '$', right: '$', display: false }
    ],
    throwOnError: false
  });
}

function promoteLooseLatexText(rootElement, options = {}) {
  const maxNodes = Number.isFinite(options.maxNodes) ? options.maxNodes : 120;
  const maxChars = Number.isFinite(options.maxChars) ? options.maxChars : 22000;
  let currentChars = 0;

  const walker = document.createTreeWalker(
    rootElement,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) => {
        if (!node || !node.nodeValue) {
          return NodeFilter.FILTER_REJECT;
        }
        const parent = node.parentElement;
        if (!parent || parent.closest('code, pre, script, style, .katex')) {
          return NodeFilter.FILTER_REJECT;
        }
        return NodeFilter.FILTER_ACCEPT;
      }
    }
  );

  const textNodes = [];
  while (walker.nextNode()) {
    if (textNodes.length >= maxNodes || currentChars >= maxChars) {
      break;
    }
    const node = walker.currentNode;
    const value = node && node.nodeValue ? node.nodeValue : '';
    if (!value || !/[\\_^=~]/.test(value) || value.length > 1200) {
      continue;
    }
    textNodes.push(node);
    currentChars += value.length;
  }

  textNodes.forEach((node) => {
    const original = node.nodeValue;
    const lines = original.split('\n');
    const replacedLines = lines.map((line) => wrapFormulaFragmentsInLine(line));
    const replaced = replacedLines.join('\n');
    if (replaced !== original) {
      node.nodeValue = replaced;
    }
  });
}

function wrapFormulaFragmentsInLine(line) {
  if (!line) {
    return line;
  }
  if (line.includes('$')) {
    return line;
  }

  // Pattern 1: LaTeX-command-driven fragments, e.g. \Delta \text{MI} = +5.02
  const commandDriven = /\\[A-Za-z]+(?:\s*\{[^{}]*\}|\s*\\[A-Za-z]+|\s*[_^]\{?[^{}\s]+\}?|\s*[A-Za-z0-9()+\-*/=.,{}\[\]\\~]+)*/g;
  const replacedCommandDriven = line.replace(commandDriven, (segment) => {
    const trimmed = segment.trim();
    if (!isLikelyFormulaFragment(trimmed)) {
      return segment;
    }
    return `$${trimmed}$`;
  });
  if (replacedCommandDriven !== line) {
    return replacedCommandDriven;
  }

  // Pattern 2: Symbol-heavy algebraic fragments without leading backslash,
  // e.g. y_{i}^{(0)} ~ A(y|x,z_i)
  const algebraic = /[A-Za-z](?:\s*[_^]\{?[^{}\s]+\}?)+(?:\s*[~+=\-*/]\s*[A-Za-z0-9\\{}_^().,+\-*/\s]+)?/g;
  const replacedAlgebraic = line.replace(algebraic, (segment) => {
    const trimmed = segment.trim();
    if (!isLikelyFormulaFragment(trimmed)) {
      return segment;
    }
    return `$${trimmed}$`;
  });
  if (replacedAlgebraic !== line) {
    return replacedAlgebraic;
  }

  // Fallback: formula-only line.
  const trimmed = line.trim();
  if (!trimmed || !isLikelyFormulaLine(trimmed)) {
    return line;
  }
  return line.replace(trimmed, `$${trimmed}$`);
}

function isLikelyFormulaFragment(text) {
  if (!text) {
    return false;
  }
  if (/[\u4e00-\u9fff]/.test(text)) {
    return false;
  }
  if (text.length < 3) {
    return false;
  }

  const hasLatexCommand = /\\[A-Za-z]+/.test(text);
  const hasScript = /[_^]\{?[^{}\s]+\}?/.test(text);
  const hasMathRelation = /[=~+\-*/]/.test(text);
  const hasMathContainer = /[(){}\[\]]/.test(text);

  return (hasLatexCommand && (hasMathRelation || hasMathContainer || hasScript)) ||
    (hasScript && (hasMathRelation || hasMathContainer));
}

function isLikelyFormulaLine(text) {
  if (!text) {
    return false;
  }
  const cjkMatches = text.match(/[\u4e00-\u9fff]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  if (cjkCount > 4) {
    return false;
  }

  const hasStrongLatexToken = /(\\(text|frac|sqrt|Delta|alpha|beta|gamma|theta|lambda|mu|sigma|pi|sum|int|mathbf|mathrm|mathbb|cdot|times|leq|geq|approx|neq|sim))/i.test(text);
  const hasMathStructure = /[_^{}]/.test(text) && /=|\\frac|\\text|\\math|\\Delta/.test(text);
  const looksLikeEquation = /^[A-Za-z0-9\\_^{\[\]().,+\-*/=\s]+$/.test(text) && (text.includes('=') || /[_^]/.test(text));

  return hasStrongLatexToken || hasMathStructure || looksLikeEquation;
}

async function convertKatexToImages(rootElement) {
  if (!rootElement || typeof html2canvas !== 'function') {
    console.warn('[FisherAI] WPS copy: html2canvas not available');
    return;
  }

  const katexNodes = Array.from(rootElement.querySelectorAll('.katex'));
  console.log('[FisherAI] WPS copy: detected', katexNodes.length, 'formula(s)');
  if (katexNodes.length === 0) return;

  let converted = 0;

  async function processOne(katexNode) {
    if (!katexNode.parentNode) return;

    const displayWrapper = katexNode.closest('.katex-display');
    let isDisplay = !!displayWrapper;
    // If .katex-display is inside a <p>/<li>/<span> with surrounding text, keep inline
    if (isDisplay && displayWrapper.parentElement) {
      const parent = displayWrapper.parentElement;
      if (parent.tagName === 'P' || parent.tagName === 'LI' || parent.tagName === 'SPAN') {
        const siblingText = parent.textContent.replace(displayWrapper.textContent, '').trim();
        if (siblingText.length > 0) {
          isDisplay = false;
        }
      }
    }

    // Dynamically measure how much the rendered content overflows the element bounds.
    // Only measure .katex-html descendants (the visual part), excluding .strut elements
    // which are invisible layout helpers with exaggerated heights.
    const katexHtml = katexNode.querySelector('.katex-html');
    if (katexHtml) {
      const katexRect = katexNode.getBoundingClientRect();
      let minY = katexRect.top, maxY = katexRect.bottom;
      katexHtml.querySelectorAll('span:not(.strut):not(.vlist):not(.vlist-r):not(.vlist-s)').forEach(child => {
        const r = child.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return;
        if (r.top < minY) minY = r.top;
        if (r.bottom > maxY) maxY = r.bottom;
      });
      const overflowTop = katexRect.top - minY;
      const overflowBottom = maxY - katexRect.bottom;
      if (overflowTop > 1) {
        katexNode.style.paddingTop = `${Math.ceil(overflowTop) + 2}px`;
      }
      if (overflowBottom > 1) {
        katexNode.style.paddingBottom = `${Math.ceil(overflowBottom) + 2}px`;
      }
    }

    const canvas = await html2canvas(katexNode, {
      backgroundColor: '#ffffff',
      scale: 1.5,
      logging: false,
      useCORS: true
    });

    if (canvas.width === 0 || canvas.height === 0) {
      console.warn('[FisherAI] WPS copy: empty canvas, skipping');
      return;
    }

    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.alt = extractKatexAltText(katexNode);
    img.style.verticalAlign = 'middle';

    if (isDisplay) {
      // Wrap display formula in a centered <p> so WPS treats it as a paragraph,
      // not an extra line break from display:block on the image itself.
      const wrapper = document.createElement('p');
      wrapper.style.textAlign = 'center';
      wrapper.style.margin = '8px 0';
      wrapper.appendChild(img);
      if (displayWrapper && displayWrapper.parentNode) {
        displayWrapper.replaceWith(wrapper);
      } else {
        katexNode.replaceWith(wrapper);
      }
    } else {
      if (displayWrapper && displayWrapper.parentNode) {
        displayWrapper.replaceWith(img);
      } else {
        katexNode.replaceWith(img);
      }
    }
    converted++;
  }

  // Process formulas in parallel batches of 3 for speed
  const BATCH = 3;
  for (let i = 0; i < katexNodes.length; i += BATCH) {
    const batch = katexNodes.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(node => processOne(node).catch(err => {
      console.error('[FisherAI] WPS copy: formula error:', err);
    })));
  }

  console.log('[FisherAI] WPS copy: converted', converted, '/', katexNodes.length, 'formula(s) to images');
}

function extractKatexAltText(katexNode) {
  if (!katexNode) {
    return 'formula';
  }
  const annotation = katexNode.querySelector('annotation');
  if (annotation && annotation.textContent) {
    return annotation.textContent.trim();
  }
  return 'formula';
}

/**
 * Apply inline styles to all HTML elements for WPS compatibility.
 * Chrome strips <style> blocks when writing text/html to clipboard,
 * so all styles must be inline for WPS/Word to render them.
 */
function inlineStylesForWps(rootElement) {
  if (!rootElement) return;

  rootElement.querySelectorAll('h1').forEach(el => {
    el.style.fontSize = '22px';
    el.style.fontWeight = 'bold';
    el.style.margin = '16px 0 8px';
    el.style.color = '#111827';
    el.style.lineHeight = '1.3';
  });
  rootElement.querySelectorAll('h2').forEach(el => {
    el.style.fontSize = '18px';
    el.style.fontWeight = 'bold';
    el.style.margin = '14px 0 6px';
    el.style.color = '#111827';
    el.style.lineHeight = '1.3';
  });
  rootElement.querySelectorAll('h3, h4').forEach(el => {
    el.style.fontSize = '16px';
    el.style.fontWeight = 'bold';
    el.style.margin = '12px 0 6px';
    el.style.color = '#111827';
    el.style.lineHeight = '1.3';
  });
  rootElement.querySelectorAll('p').forEach(el => {
    el.style.margin = el.style.margin || '8px 0';
    el.style.lineHeight = '1.65';
    el.style.fontSize = '14px';
  });
  rootElement.querySelectorAll('ul, ol').forEach(el => {
    el.style.margin = '8px 0';
    el.style.paddingLeft = '24px';
  });
  rootElement.querySelectorAll('li').forEach(el => {
    el.style.margin = '4px 0';
    el.style.lineHeight = '1.65';
  });
  rootElement.querySelectorAll('strong, b').forEach(el => {
    el.style.fontWeight = 'bold';
  });
  rootElement.querySelectorAll('em, i').forEach(el => {
    el.style.fontStyle = 'italic';
  });
  rootElement.querySelectorAll('pre').forEach(el => {
    el.style.backgroundColor = '#f3f4f6';
    el.style.padding = '12px';
    el.style.fontFamily = "'Courier New', Consolas, monospace";
    el.style.fontSize = '13px';
    el.style.lineHeight = '1.5';
    el.style.whiteSpace = 'pre-wrap';
    el.style.wordWrap = 'break-word';
    el.style.margin = '10px 0';
    el.style.color = '#1f2937';
  });
  rootElement.querySelectorAll('code').forEach(el => {
    if (el.parentElement && el.parentElement.tagName !== 'PRE') {
      el.style.backgroundColor = '#f3f4f6';
      el.style.padding = '2px 5px';
      el.style.fontFamily = "'Courier New', Consolas, monospace";
      el.style.fontSize = '13px';
      el.style.color = '#d63384';
    }
  });
  rootElement.querySelectorAll('blockquote').forEach(el => {
    el.style.borderLeft = '4px solid #d1d5db';
    el.style.paddingLeft = '16px';
    el.style.margin = '10px 0';
    el.style.color = '#6b7280';
    el.style.fontStyle = 'italic';
  });
  rootElement.querySelectorAll('table').forEach(el => {
    el.style.borderCollapse = 'collapse';
    el.style.width = '100%';
    el.style.margin = '10px 0';
  });
  rootElement.querySelectorAll('th, td').forEach(el => {
    el.style.border = '1px solid #d1d5db';
    el.style.padding = '8px 12px';
    el.style.textAlign = 'left';
    el.style.fontSize = '14px';
  });
  rootElement.querySelectorAll('th').forEach(el => {
    el.style.backgroundColor = '#f3f4f6';
    el.style.fontWeight = 'bold';
  });
  rootElement.querySelectorAll('img').forEach(el => {
    if (!el.style.maxWidth) {
      el.style.maxWidth = '100%';
    }
    el.style.height = 'auto';
  });
  rootElement.querySelectorAll('a').forEach(el => {
    el.style.color = '#2563eb';
    el.style.textDecoration = 'underline';
  });
}

/**
 * Fallback: copy rich HTML via deprecated execCommand('copy').
 * The browser auto-inlines computed CSS styles when copying a selection,
 * which produces better WPS/Word compatibility.
 */
function copyRichTextViaExecCommand(htmlContent) {
  const tempDiv = document.createElement('div');
  tempDiv.style.position = 'fixed';
  tempDiv.style.left = '-9999px';
  tempDiv.style.top = '0';
  tempDiv.style.opacity = '0.01';
  tempDiv.style.pointerEvents = 'none';
  tempDiv.innerHTML = htmlContent;
  document.body.appendChild(tempDiv);

  const range = document.createRange();
  range.selectNodeContents(tempDiv);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);

  const success = document.execCommand('copy');
  selection.removeAllRanges();
  document.body.removeChild(tempDiv);

  if (!success) {
    throw new Error('execCommand copy returned false');
  }
}

function buildWpsClipboardDocument(contentNode) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title></title>
</head>
<body style="margin:24px;color:#111827;line-height:1.65;font-size:14px;font-family:'Segoe UI',Arial,sans-serif;">
<div id="fisherai-copy-root">${contentNode.innerHTML}</div>
</body>
</html>`;
}

function buildWpsClipboardFragment(contentNode) {
  return `<div id="fisherai-copy-root" style="margin:24px;color:#111827;line-height:1.65;font-size:14px;font-family:'Segoe UI',Arial,sans-serif;">${contentNode.innerHTML}</div>`;
}

async function waitForImagesReady(rootElement, timeoutMs = 1500) {
  if (!rootElement) {
    return;
  }

  const images = Array.from(rootElement.querySelectorAll('img'));
  if (images.length === 0) {
    return;
  }

  await Promise.all(images.map((img) => {
    if (img.complete && img.naturalWidth > 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        img.removeEventListener('load', done);
        img.removeEventListener('error', done);
        resolve();
      };
      const timer = setTimeout(done, timeoutMs);
      img.addEventListener('load', done);
      img.addEventListener('error', done);
    });
  }));
}


/**
 * 隐藏提交按钮 & 展示生成按钮
 */
function hideSubmitBtnAndShowGenBtn() {
  const submitBtn = document.querySelector('#my-extension-submit-btn');
  submitBtn.style.cssText = 'display: none !important';
  const generateBtn = document.querySelector('#my-extension-generate-btn');
  generateBtn.style.cssText = 'display: flex !important';
  const inputBtn = document.querySelector('#my-extension-user-input');
  inputBtn.disabled = true;
}

/**
 * 展示提交按钮 & 隐藏生成按钮
 */
function showSubmitBtnAndHideGenBtn() {
  const submitBtn = document.querySelector('#my-extension-submit-btn');
  submitBtn.style.cssText = 'display: flex !important';
  updateSubmitButton();
  const generateBtn = document.querySelector('#my-extension-generate-btn');
  generateBtn.style.cssText = 'display: none !important';
  const inputBtn = document.querySelector('#my-extension-user-input');
  inputBtn.disabled = false;
}

/**
 * 根据选择的模型判断是否支持上传图像或文件
 * @param {string} selectedModel 
 */
function toggleImageUpload(selectedModel) {
  const imageUploadDiv = document.getElementById('image-upload-div');
  const imageUpload = document.getElementById('image-upload');
  const imageUploadLabel = document.getElementById('image-upload-label');
  
  // 使用窗口全局变量（如果存在）或者回退到常量
  const imageSupportModels = window.IMAGE_SUPPORT_MODELS || IMAGE_SUPPORT_MODELS;
  const anyFileSupportModels = window.ANY_FILE_SUPPORT_MODELS || ANY_FILE_SUPPORT_MODELS;
  
  if (imageSupportModels.includes(selectedModel)) {
      // 如果模型支持图像，启用上传区域
      imageUploadDiv.style.opacity = '1';
      imageUpload.disabled = false;
      imageUploadLabel.style.pointerEvents = 'auto';
      imageUpload.setAttribute('accept', 'image/*');
      if(anyFileSupportModels.includes(selectedModel)) {
        imageUpload.removeAttribute('accept');
      }
  } else {
      // 如果模型不支持图像，禁用上传区域
      imageUploadDiv.style.opacity = '0.5';
      imageUpload.disabled = true;
      imageUploadLabel.style.pointerEvents = 'none';
  }
}

function loadImage(imgElement) {
  return new Promise((resolve, reject) => {
      if (imgElement.complete && imgElement.naturalHeight !== 0) {
          resolve();
      } else {
          imgElement.onload = () => resolve();
          imgElement.onerror = () => reject(new Error('Image failed to load: ' + imgElement.src));
      }
  });
}

async function loadAllImages(element) {
  const imgElements = element.querySelectorAll('img');
  const loadPromises = Array.from(imgElements).map(img => loadImage(img));
  return Promise.all(loadPromises);
}

/**
 * 更新提交按钮状态
 */
function updateSubmitButton() {
  const userInput = document.getElementById('my-extension-user-input');
  const submitButton = document.getElementById('my-extension-submit-btn');
  const previewArea = document.querySelector('.image-preview-area');
  const hasUploadedImages = previewArea.querySelectorAll('.uploaded-image-preview[data-uploaded-url]').length > 0;

  if (userInput.value.trim() !== '' || hasUploadedImages) {
    submitButton.disabled = false;
    submitButton.classList.remove('disabled');
  } else {
      submitButton.disabled = true;
      submitButton.classList.add('disabled');
  }
}

function toggleShortcutMenu(inputField, shortcutMenu) {
  if (inputField.value === '/') {
      shortcutMenu.style.display = 'block';
  } else {
      shortcutMenu.style.display = 'none';
  }
}

function updatePreviewAreaVisibility() {
  const previewArea = document.querySelector('.image-preview-area');
  if (!previewArea) {
    return;
  }
  const hasItems = previewArea.querySelector('.img-container') !== null;
  if (hasItems) {
    previewArea.classList.add('is-visible');
  } else {
    previewArea.classList.remove('is-visible');
  }
}

function handleUploadFiles(event) {
  var files = event.target.files;
  var previewArea = document.querySelector('.image-preview-area');
  const submitButton = document.getElementById('my-extension-submit-btn');

  // 禁用提交按钮
  submitButton.disabled = true;
  submitButton.classList.add('disabled');

  // 追踪未完成的上传数量
  let uploadCount = files.length;

  Array.from(files).forEach(file => {
    var imgContainer = document.createElement('div');
    imgContainer.classList.add('img-container');

    var img = document.createElement('img');
    img.classList.add('uploaded-image-preview');

    // 删除按钮
    var deleteBtn = document.getElementById('delete-icon-template').cloneNode(true);
    deleteBtn.style.display = 'block';
    deleteBtn.classList.add('delete-image-btn');
    deleteBtn.removeAttribute('id');
    deleteBtn.addEventListener('click', function() {
        previewArea.removeChild(imgContainer);
        updatePreviewAreaVisibility();
        updateSubmitButton();
    });

    // 预览
    var reader = new FileReader();
    reader.onload = function(e) {
      if (file.type.startsWith('image/')) {
        img.src = e.target.result;
      } else {
        img.src = DEFAULT_FILE_LOGO_PATH;
      }
      img.setAttribute('data-base64', e.target.result);
      uploadCount--;
      if (uploadCount === 0) {
        updateSubmitButton();
      }
    };
    reader.readAsDataURL(file);

    imgContainer.appendChild(img);
    imgContainer.appendChild(deleteBtn);
    previewArea.appendChild(imgContainer);
    updatePreviewAreaVisibility();
  });

  // 清空文件输入
  var uploadInput = document.getElementById('image-upload');
  uploadInput.value = '';
  updateSubmitButton();
}


// 检测是否启用ollama，拉去ollama模型列表并追加到模型选择列表中
function loadOllamaModels(callback) {
  // 使用通用函数检查Ollama提供商是否启用
  getEnabledModels(({ providerStates }) => {
    const isEnabled = providerStates[PROVIDER_OLLAMA] !== undefined ? 
      providerStates[PROVIDER_OLLAMA] : true;
    
    // 如果提供商被禁用，直接返回空数组
    if (!isEnabled) {
      if (typeof callback === 'function') {
        callback([]);
      }
      return;
    }
    
    // 使用默认的 OLLAMA_BASE_URL
    const baseUrl = OLLAMA_BASE_URL;
    const apiUrl = baseUrl + OLLAMA_LIST_MODEL_PATH;
    
    fetch(apiUrl)
      .then(response => {
        if (response.ok) {
          return response.json();
        } else {
          const statusInfo = [response.status, response.statusText].filter(Boolean).join(' ');
          throw new Error(`拉取 Ollama 模型失败${statusInfo ? `（${statusInfo}）` : ''}`);
        }
      })
      .then(data => {
        const models = data.models;
        // 如果传入了回调函数，直接将模型数据传给回调函数
        if (typeof callback === 'function') {
          callback(models);
        } else {
          // 兼容旧的直接操作DOM的方式
          const customModelsGroup = document.getElementById('ollama-models');
          if (customModelsGroup) {
            models.forEach(model => {
              const option = document.createElement('option');
              option.value = model.model;
              option.textContent = model.name;
              customModelsGroup.appendChild(option);
            });
          }
        }
      })
      .catch(error => {
        console.error('Error loading Ollama models:', error);
        if (typeof callback === 'function') {
          callback([]);
        }
      });
  });
}


/**
 * 初始化模型选择事件监听
 */
function initModelSelectionHandler() {
  const modelSelection = document.getElementById('model-selection');
  if (!modelSelection) return;
  
  modelSelection.addEventListener('change', function() {
    toggleImageUpload(this.value);
    
    // 获取所选选项的provider信息
    const selectedOption = modelSelection.options[modelSelection.selectedIndex];
    let provider = selectedOption.dataset.provider;
    
    // 保存所选模型和provider信息
    chrome.storage.sync.set({
      'selectedModel': this.value,
      'selectedModelProvider': provider
    });
  });
}


// 保存自定义模型参数
function saveModelParams() {
  const temperature = document.getElementById('temperature').value;
  const top_p = document.getElementById('top_p').value;
  const max_tokens = document.getElementById('max_tokens').value;
  const frequency_penalty = document.getElementById('frequency_penalty').value;
  const presence_penalty = document.getElementById('presence_penalty').value;

  chrome.storage.sync.set({
      temperature: temperature,
      top_p: top_p,
      max_tokens: max_tokens,
      frequency_penalty: frequency_penalty,
      presence_penalty: presence_penalty
  }, function() {
      // console.log('model params saved');
  });
}


// 从chrome storage 加载自定义的模型参数
function loadModelParams() {
  chrome.storage.sync.get(['temperature', 'top_p', 'max_tokens'], function(items) {
      if (items.temperature !== undefined) {
          document.getElementById('temperature').value = items.temperature;
      }
      if (items.top_p !== undefined) {
          document.getElementById('top_p').value = items.top_p;
      }
      if (items.max_tokens !== undefined) {
          document.getElementById('max_tokens').value = items.max_tokens;
      }
      if (items.frequency_penalty !== undefined) {
        document.getElementById('frequency_penalty').value = items.frequency_penalty;
      }
      if (items.max_tokens !== undefined) {
        document.getElementById('presence_penalty').value = items.presence_penalty;
      }
  });
}

function loadToolsSelectedStatus() {
  chrome.storage.sync.get([SERPAPI, JINA_SEARCH, JINA_READER, DALLE, NANO_BANANA], (result) => {
    if (result.serpapi !== undefined) {
        document.getElementById(SERPAPI).checked = result.serpapi;
    }
    if (result[JINA_SEARCH] !== undefined) {
        document.getElementById(JINA_SEARCH).checked = result[JINA_SEARCH];
    }
    if (result[JINA_READER] !== undefined) {
        document.getElementById(JINA_READER).checked = result[JINA_READER];
    }
    if (result.dalle !== undefined) {
        document.getElementById(DALLE).checked = result.dalle;
    }
    if (result[NANO_BANANA] !== undefined) {
        document.getElementById(NANO_BANANA).checked = result[NANO_BANANA];
    }
  });
}

/**
 * 获取当前页面标题
 * @returns {Promise<string>}
 */
function getPageTitle() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({action: "getPageTitle"}, (response) => {
      if (chrome.runtime.lastError) {
        reject(chrome.runtime.lastError);
      } else if (response && response.title) {
        resolve(response.title);
      } else {
        reject(new Error("Unable to get page title"));
      }
    });
  });
}

/**
 * 初始化结果页面
 */
function initResultPage() {
  // 初始化国际化
  initI18n();
  
  // 应用外观模式
  applyAppearanceMode();

  // 添加全局事件委托，捕获设置按钮点击
  document.addEventListener('click', function(event) {
    if (event.target && event.target.id === 'goto-settings-btn') {
      openSettingsPage();
    }
  });

  // 加载模型选择
  populateModelSelections().then(async () => {
    // 初始化模型选择事件监听
    initModelSelectionHandler();
    
    // 加载模型参数
    loadModelParams();

    // 加载工具选择状态
    loadToolsSelectedStatus();

    // 初始化按钮状态
    updateSubmitButton();

    // 检测输入框内容变化以更新提交按钮状态
    var userInput = document.getElementById('my-extension-user-input');
    userInput.addEventListener('input', updateSubmitButton);
    const submitButton = document.getElementById('my-extension-submit-btn');
    if (submitButton && !submitButton.dataset.bound) {
      submitButton.dataset.bound = 'true';
      submitButton.addEventListener('click', handleSubmitAction);
    }
    if (userInput && !userInput.dataset.enterBound) {
      userInput.dataset.enterBound = 'true';
      userInput.addEventListener('keydown', function(event) {
        if (event.key !== 'Enter') {
          return;
        }
        if (event.shiftKey) {
          return;
        }
        event.preventDefault();
        if (userInput.value.trim() !== '') {
          handleSubmitAction();
        }
      });
    }

    // 快捷输入
    const shortcutMenu = document.getElementById('shortcut-menu');
    userInput.addEventListener('input', function(e) {
      toggleShortcutMenu(userInput, shortcutMenu);
    });
    userInput.addEventListener('keydown', function(e) {
      if (e.key === '/' && userInput.value.length === 0) {
        toggleShortcutMenu(userInput, shortcutMenu);
      }
    });
    userInput.addEventListener('blur', function() {
      setTimeout(() => {
          shortcutMenu.style.display = 'none';
      }, 200); // delay to allow click event on menu items
    });
    const menuItems = shortcutMenu.querySelectorAll('div');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
          userInput.value = this.getAttribute('data-command');
          shortcutMenu.style.display = 'none';
          userInput.focus();
        });
    });

    // 模型参数设置
    const paramsBtn = document.getElementById('params-div');
    const modelParamsPopupDiv = document.getElementById('model-params');
    paramsBtn.addEventListener('click', function(event) {
      event.stopPropagation();
      modelParamsPopupDiv.style.display = 'block';
      toolStorePopupDiv.style.display = 'none';
    });
    modelParamsPopupDiv.addEventListener('click', function(event) {
      event.stopPropagation(); // Prevent this click from triggering the document click event
    });

    // 保存模型参数设置
    document.getElementById('temperature').addEventListener('change', saveModelParams);
    document.getElementById('top_p').addEventListener('change', saveModelParams);
    document.getElementById('max_tokens').addEventListener('change', saveModelParams);

    // 工具箱
    const toolsBtn = document.getElementById('tools-div');
    const toolStorePopupDiv = document.getElementById('tool-store');
    toolsBtn.addEventListener('click', function(event) {
      event.stopPropagation();
      toolStorePopupDiv.style.display = 'block';
      modelParamsPopupDiv.style.display = 'none';
    });

    // 保存工具选择状态
    const toolCheckboxes = document.querySelectorAll('#tool-store input[type="checkbox"]');
    toolCheckboxes.forEach(checkbox => {
      checkbox.addEventListener('change', (event) => {
          const toolId = event.target.id;
          const isChecked = event.target.checked;

          let storageObject = {};
          storageObject[toolId] = isChecked;
          chrome.storage.sync.set(storageObject, () => {
              // console.log(`Saved ${toolId} state: ${isChecked}`);
          });
      });
    });

    // 点击事件
    document.addEventListener('click', function(event) {
      if (!modelParamsPopupDiv.contains(event.target) && event.target !== paramsBtn) {
        modelParamsPopupDiv.style.display = 'none';
      }
      if(!toolStorePopupDiv.contains(event.target) && event.target !== toolsBtn) {
        toolStorePopupDiv.style.display = 'none';
      }
    });

    // 图片上传预览
    document.getElementById('image-upload').addEventListener('change', function(event) {
      handleUploadFiles(event);
    });

    // 粘贴
    document.addEventListener('paste', async (event) => {
      const modelSelection = document.getElementById('model-selection');
      const selectedModel = modelSelection.value;
      
      // 使用窗口全局变量（如果存在）或者回退到常量
      const imageSupportModels = window.IMAGE_SUPPORT_MODELS || IMAGE_SUPPORT_MODELS;
      
      if (!imageSupportModels.includes(selectedModel)) {
        return;
      }

      const items = event.clipboardData.items;
      let files = [];
      for (let item of items) {
          if (item.type.startsWith('image')) {
              const file = item.getAsFile();
              files.push(file);
          }
      }
      if (files.length > 0) {
        handleUploadFiles({ target: { files: files } });
      }
    });

    // 清空历史记录逻辑
    var label = document.getElementById('newchat-label');
    label.addEventListener('click', async function() {
      // 保存当前会话
      await _autoSaveCurrentSession();
      // 清空上传图片预览界面
      const previewArea = document.querySelector('.image-preview-area');
      previewArea.innerHTML = '';
      updatePreviewAreaVisibility();
      // 新建同页会话（立即创建新 session id）
      await _createBlankSessionForCurrentTab();
    });

    // 摘要逻辑
    // 立即填充摘要提示词下拉框默认选项（避免初始为空）
    const summaryPromptSelect = document.getElementById('summary-prompt-select');
    if (summaryPromptSelect && summaryPromptSelect.options.length === 0) {
      DEFAULT_SUMMARY_PROMPTS.forEach(function(p) {
        const option = document.createElement('option');
        option.value = p.id;
        option.textContent = p.name;
        option.dataset.prompt = p.prompt;
        summaryPromptSelect.appendChild(option);
      });
    }
    // 异步加载用户自定义的摘要提示词列表（覆盖默认）
    loadSummaryPromptsList(function(prompts) {
      const summaryPromptSelect = document.getElementById('summary-prompt-select');
      if (summaryPromptSelect) {
        summaryPromptSelect.innerHTML = '';
        prompts.forEach(function(p) {
          const option = document.createElement('option');
          option.value = p.id;
          option.textContent = p.name;
          option.dataset.prompt = p.prompt;
          summaryPromptSelect.appendChild(option);
        });
        // 恢复上次选择
        chrome.storage.sync.get(['selected_summary_prompt_id'], function(result) {
          if (result.selected_summary_prompt_id) {
            const exists = Array.from(summaryPromptSelect.options).some(opt => opt.value === result.selected_summary_prompt_id);
            if (exists) {
              summaryPromptSelect.value = result.selected_summary_prompt_id;
            }
          }
        });
        // 保存选择
        summaryPromptSelect.addEventListener('change', function() {
          chrome.storage.sync.set({ selected_summary_prompt_id: this.value });
        });
      }
    });

    var summaryButton = document.querySelector('#my-extension-summary-btn');
    summaryButton.addEventListener('click', async function() {
      const modelSelection = document.getElementById('model-selection');
      const model = modelSelection.value;
      const selectedOption = modelSelection.options[modelSelection.selectedIndex];
      const provider = selectedOption.dataset.provider;
      const apiKeyValid = await verifyApiKeyConfigured(provider);
      if(!apiKeyValid) {
        return;
      }
      let inputText = '';
      const currentURL = await getCurrentURL();

      try {
        if(isVideoUrl(currentURL)) {
          // 视频摘要
          displayLoading('正在获取字幕...');
          inputText = await extractSubtitles(currentURL, FORMAT_TEXT);
        } else if(isPDFUrl(currentURL)) {
          // PDF摘要
          displayLoading('正在提取PDF内容...');
          inputText = await extractPDFText(currentURL);
        } else {
          // 网页摘要
          displayLoading('正在提取网页内容...');
          inputText = await fetchPageContent(FORMAT_TEXT);
        }
      } catch(error) {
        hiddenLoadding();
        console.error('智能摘要失败', error);
        displayErrorMessage(error, {
          context: '智能摘要',
          defaultMessage: '暂时无法生成摘要，请稍后重试。'
        });
        return;
      }

      // 获取选中的摘要提示词
      let selectedSummaryPrompt = SUMMARY_PROMPT;
      const summaryPromptSelect = document.getElementById('summary-prompt-select');
      if (summaryPromptSelect) {
        const summarySelectedOption = summaryPromptSelect.options[summaryPromptSelect.selectedIndex];
        if (summarySelectedOption && summarySelectedOption.dataset.prompt) {
          selectedSummaryPrompt = summarySelectedOption.dataset.prompt;
        }
      }

      await clearAndGenerate(model, provider, selectedSummaryPrompt + inputText, null, inputText);
    });

    // 网页翻译
    var translateButton = document.querySelector('#my-extension-translate-btn');
    translateButton.addEventListener('click', async function() {
      const modelSelection = document.getElementById('model-selection');
      const model = modelSelection.value;
      const selectedOption = modelSelection.options[modelSelection.selectedIndex];
      const provider = selectedOption.dataset.provider;
      const apiKeyValid = await verifyApiKeyConfigured(provider);
      if(!apiKeyValid) {
        return;
      }
      let inputText = '';
      const currentURL = await getCurrentURL();

      try {
        if(isVideoUrl(currentURL)) {
          // 视频翻译
          displayLoading('正在获取字幕...');
          inputText = await extractSubtitles(currentURL, FORMAT_TEXT);
        } else if(isPDFUrl(currentURL)) {
          // PDF 翻译
          displayLoading('正在提取PDF内容...');
          inputText = await extractPDFText(currentURL);
        } else {
          // 网页翻译
          displayLoading('正在提取网页内容...');
          inputText = await fetchPageContent();
        }
      } catch(error) {
        hiddenLoadding();
        console.error('网页翻译失败', error);
        displayErrorMessage(error, {
          context: '网页翻译',
          defaultMessage: '暂时无法翻译当前页面，请稍后重试。'
        });
        return;
      }

      const translatePrompt = await getTranslatePrompt();

      await clearAndGenerate(model, provider, translatePrompt + inputText, null, inputText);
    });

    // 视频翻译
    var videoTranslateButton = document.querySelector('#my-extension-videotrans-btn');
    videoTranslateButton.addEventListener('click', async function() {
      const modelSelection = document.getElementById('model-selection');
      const model = modelSelection.value;
      const selectedOption = modelSelection.options[modelSelection.selectedIndex];
      const provider = selectedOption.dataset.provider;
      const apiKeyValid = await verifyApiKeyConfigured(provider);
      if(!apiKeyValid) {
        return;
      }
      const currentURL = await getCurrentURL();
      if(!isVideoUrl(currentURL)) {
        return;
      }

      let inputText = '';
      try {
        // 视频翻译
        displayLoading('正在获取字幕...');
        inputText = await extractSubtitles(currentURL, FORMAT_TEXT);
      } catch(error) {
        hiddenLoadding();
        console.error('视频翻译失败', error);
        displayErrorMessage(error, {
          context: '视频翻译',
          defaultMessage: '暂时无法翻译当前视频，请稍后再试。'
        });
        return;
      }

      const subTitleTransPrompt = await getSubTitleTransPrompt();

      await clearAndGenerate(model, provider, subTitleTransPrompt + inputText, null, inputText);
    });


    // 停止生成逻辑
    var cancelBtn = document.querySelector('#my-extension-generate-btn');
    cancelBtn.addEventListener('click', function() {
      cancelRequest();
      showSubmitBtnAndHideGenBtn();
    });

    // 设置逻辑
    var settingsButton = document.querySelector('.my-extension-settings-btn');
    if (settingsButton) {
      settingsButton.addEventListener('click', function() {
        // 发送消息到background script打开新标签页
        openSettingsPage();
      });
    }

    // 分享逻辑
    var shareButton = document.querySelector('.my-extension-share-btn');
    if(shareButton) {
      shareButton.addEventListener('click', async function() {
        const contentDiv = document.querySelector('.my-extension-content');

        // 等待所有图片加载完成
        try {
          const chatDiv = document.querySelector('.chat-content');
          await loadAllImages(chatDiv);
        } catch (error) {
          console.error('Some images failed to load:', error);
          return;
        }
         
        // 保存原始样式
        var originalStyle = {
            height: contentDiv.style.height,
            width: contentDiv.style.width
        };

        const pageTitle = await getPageTitle();

        // Create a new div element off-screen
        const newDiv = document.createElement('div');
        newDiv.innerHTML = contentDiv.innerHTML;
        newDiv.style.cssText = `
          position: absolute;
          left: -9999px;
          top: -9999px;
          width: ${contentDiv.offsetWidth}px;
          background-color: #FAF8F6;
          border-radius: 16px;
          padding: 15px 25px;
        `;

        // Remove the first h1 element (summary title)
        const firstH1 = newDiv.querySelector('h1');
        if (firstH1) {
          firstH1.remove();
        }
        // 添加标题
        const titleElement = document.createElement('h1');
        titleElement.textContent = pageTitle;
        titleElement.style.cssText = `
          font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
          font-size: 24px;
          font-weight: 600;
          color: #2c3e50;
          margin: 0 0 25px 0;
          padding: 20px 15px;
          text-align: center;
          letter-spacing: 0.5px;
          line-height: 1.4;
          max-width: 90%;
          margin-left: auto;
          margin-right: auto;
          border-bottom: 2px solid #ecf0f1;
          transition: all 0.3s ease;
        `;
        newDiv.insertBefore(titleElement, newDiv.firstChild);

        // 修改文本样式
        newDiv.querySelectorAll('p, li').forEach(element => {
          element.style.cssText = `
            font-family: 'Open Sans', Arial, sans-serif;
            font-size: 16px;
            line-height: 1.6;
            color: #34495e;
            margin-bottom: 12px;
          `;
        });

        // 加载二维码图片
        const qrCode = new Image();
        qrCode.src = chrome.runtime.getURL('images/chromestore.png');
        qrCode.onload = function() {
          const footerDiv = document.createElement('div');
          footerDiv.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px 0;
            color: #333;
            font-size: 14px;
            margin-top: 20px;
            border-top: 1px solid #ddd;
          `;

          const explanationText = document.createElement('p');
          explanationText.textContent = 'FisherAI — Your Best Summary Copilot';
          explanationText.style.cssText = `
            margin: 0;
            color: #2c3e50;
            font-family: 'Roboto', sans-serif;
            font-size: 18px;
            font-weight: 500;
            letter-spacing: 0.7px;
            text-align: center;
          `;

          qrCode.style.width = '70px';
          qrCode.style.height = '70px';
          qrCode.style.marginLeft = '5px';

          const textQrWrapper = document.createElement('div');
          textQrWrapper.style.cssText = `
            display: flex;
            align-items: center;
            justify-content: center;
          `;

          textQrWrapper.appendChild(explanationText);
          textQrWrapper.appendChild(qrCode);
          footerDiv.appendChild(textQrWrapper);

          newDiv.appendChild(footerDiv);

          // Append the new div to body
          document.body.appendChild(newDiv);

          // Render the new div
          html2canvas(newDiv, {
            backgroundColor: '#1F2937',
            useCORS: true
          }).then(canvas => {
            canvas.toBlob(function(blob) {
              var url = URL.createObjectURL(blob);
              window.open(url, '_blank');
            }, 'image/png');
          }).catch(error => {
            console.error('Error rendering canvas:', error);
          }).finally(() => {
            // Remove the temporary div
            document.body.removeChild(newDiv);
          });
        };
      });
    }

  });
}

// 使用常量中定义的模型列表填充模型选择下拉框
async function populateModelSelections() {
  const modelSelection = document.getElementById('model-selection');
  if (!modelSelection) return;
  
  // 清空现有的选项，保留optgroup结构
  const optgroups = modelSelection.querySelectorAll('optgroup');
  const freeModelsGroup = optgroups[0];
  const customModelsGroup = optgroups[1];
  const ollamaModelsGroup = optgroups[2] || null;
  
  // 清空现有选项
  while (freeModelsGroup.firstChild) {
    freeModelsGroup.removeChild(freeModelsGroup.firstChild);
  }
  
  while (customModelsGroup.firstChild) {
    customModelsGroup.removeChild(customModelsGroup.firstChild);
  }
  
  if (ollamaModelsGroup) {
    while (ollamaModelsGroup.firstChild) {
      ollamaModelsGroup.removeChild(ollamaModelsGroup.firstChild);
    }
  }
  
  // 使用通用函数获取启用的模型
  await getEnabledModels(({ filteredFreeModels }) => {
    // 添加免费模型
    filteredFreeModels.forEach(model => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.display;
      option.dataset.provider = model.provider;
      freeModelsGroup.appendChild(option);
    });
  });
  
  // 从设置页面加载自定义配置模型
  await loadCustomModelsFromSettings(customModelsGroup);
  
  // 如果有Ollama模型组，加载Ollama模型（不阻塞，后台加载）
  if (ollamaModelsGroup) {
    loadOllamaModels((models) => {
      models.forEach(model => {
        const option = document.createElement('option');
        option.value = `${model.name}`;
        option.textContent = `${model.name}`;
        option.dataset.provider = 'ollama';
        ollamaModelsGroup.appendChild(option);
      });
    });
  }
  
  // 恢复保存的模型选择
  await restoreSavedModelSelection();
}

/**
 * 恢复保存的模型选择
 */
function restoreSavedModelSelection() {
  const modelSelection = document.getElementById('model-selection');
  if (!modelSelection) return Promise.resolve();

  return new Promise(resolve => {
    chrome.storage.sync.get(['selectedModel'], function(result) {
      const fallbackOption = modelSelection.options[0] || null;
      if (result.selectedModel) {
        // 检查保存的模型是否在当前可用的选项中
        const modelExists = Array.from(modelSelection.options).some(option => option.value === result.selectedModel);
        if (modelExists) {
          modelSelection.value = result.selectedModel;
        } else if (fallbackOption) {
          modelSelection.value = fallbackOption.value;
        }
      } else if (fallbackOption) {
        // 如果没有保存的模型，使用默认模型
        modelSelection.value = fallbackOption.value;
      }
      if (modelSelection.value) {
        toggleImageUpload(modelSelection.value);
      }
      resolve();
    });
  });
}

/**
 * 从设置页面加载自定义配置模型
 * @param {HTMLElement} customModelsGroup - 自定义模型的optgroup元素
 */
async function loadCustomModelsFromSettings(customModelsGroup) {
  // 清空现有选项
  while (customModelsGroup.firstChild) {
    customModelsGroup.removeChild(customModelsGroup.firstChild);
  }
  
  // 使用通用函数直接获取所有启用的自定义模型
  await new Promise(resolve => {
    getEnabledModels(({ filteredCustomConfigModels }) => {
      // 添加所有过滤后的自定义模型
      filteredCustomConfigModels.forEach(model => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.display;
        option.dataset.provider = model.provider;
        customModelsGroup.appendChild(option);
      });
      resolve();
    });
  });
}


/**
 * 是否是视频页面
 * @returns 
 */
function isVideoUrl(url) {
  const patterns = [
    /^https?:\/\/(?:www\.)?youtube\.com\/watch/, // 匹配 YouTube 观看页面
    /^https?:\/\/(?:www\.)?bilibili\.com\/video\//, // 匹配 Bilibili 视频页面
    /^https?:\/\/(?:www\.)?bilibili\.com\/list\/watchlater/ // 匹配 Bilibili 稍后再看页
  ];
  
  return patterns.some(pattern => pattern.test(url));
}

function normalizeErrorTitle(context, explicitTitle) {
  if (explicitTitle) {
    return explicitTitle;
  }
  if (context) {
    if (/(失败|异常|错误|取消)$/.test(context)) {
      return context;
    }
    return `${context}失败`;
  }
  return '请求异常';
}

function extractErrorMessageText(errorInput) {
  if (errorInput == null) {
    return '';
  }
  if (errorInput instanceof Error && typeof errorInput.message === 'string') {
    return errorInput.message;
  }
  if (typeof errorInput === 'string') {
    return errorInput;
  }
  if (typeof errorInput === 'object') {
    if (typeof errorInput.message === 'string') {
      return errorInput.message;
    }
    if (typeof errorInput.error === 'string') {
      return errorInput.error;
    }
    if (errorInput.error && typeof errorInput.error.message === 'string') {
      return errorInput.error.message;
    }
    if (typeof errorInput.statusText === 'string') {
      return errorInput.statusText;
    }
    try {
      const serialized = JSON.stringify(errorInput);
      return serialized === '{}' ? '' : serialized;
    } catch (serializationError) {
      return '';
    }
  }
  return String(errorInput);
}

function deriveFriendlyErrorDetail(rawMessage, defaultMessage) {
  const fallbackDetail = defaultMessage || '发生未知错误，请稍后重试。';
  const trimmedMessage = (rawMessage || '').trim();
  if (!trimmedMessage) {
    return { detail: fallbackDetail, raw: '' };
  }

  const normalized = trimmedMessage.toLowerCase();
  const mappings = [
    { pattern: /(aborterror|the operation was aborted|request was aborted|user aborted)/i, message: '请求已取消。' },
    { pattern: /(failed to fetch|networkerror|network request failed|net::|connection (?:refused|reset|aborted|closed)|dns|ssl|certificate)/i, message: '网络请求失败，请检查网络连接或 API 代理配置。' },
    { pattern: /(timeout|timed out|超时)/i, message: '请求超时，请稍后重试。' },
    { pattern: /(401|unauthorized|invalid api key|incorrect api key|no api key)/i, message: '身份验证失败，请检查 API Key 是否正确配置。' },
    { pattern: /(429|too many requests|rate limit)/i, message: '请求过于频繁，请稍后再试。' },
    { pattern: /(insufficient[_\s-]?quota|余额不足|\bquota\b|\bquotas\b|credit limit|\bcredit\b)/i, message: '账号配额不足，请检查账户状态或更换模型。' },
    { pattern: /(403|forbidden|access denied|permission)/i, message: '服务拒绝请求，可能是权限或配额不足。' },
    { pattern: /(500|502|503|504|server error|bad gateway|service unavailable)/i, message: '服务暂时不可用，请稍后重试。' }
  ];

  for (const mapping of mappings) {
    if (mapping.pattern.test(normalized)) {
      return { detail: mapping.message, raw: trimmedMessage };
    }
  }

  return { detail: trimmedMessage, raw: '' };
}

function buildErrorDisplayInfo(errorInput, options) {
  const opts = options || {};
  const rawMessage = extractErrorMessageText(errorInput);
  const detailInfo = deriveFriendlyErrorDetail(rawMessage, opts.defaultMessage);
  return {
    title: normalizeErrorTitle(opts.context, opts.title),
    detail: detailInfo.detail,
    raw: detailInfo.raw && detailInfo.raw !== detailInfo.detail ? detailInfo.raw : ''
  };
}

/**
 * 显示错误信息
 * @param {Error|string|Object} errorInput
 * @param {{context?: string, title?: string, defaultMessage?: string}|string} [options]
 */
function displayErrorMessage(errorInput, options) {
  const normalizedOptions = typeof options === 'string' ? { context: options } : (options || {});
  hideRecommandContent();
  const contentDiv = document.querySelector('.chat-content');
  if (!contentDiv) {
    return;
  }

  const info = buildErrorDisplayInfo(errorInput, normalizedOptions);
  const container = document.createElement('div');
  container.className = 'error-message';

  if (info.title) {
    const titleElement = document.createElement('div');
    titleElement.className = 'error-message__title';
    titleElement.textContent = info.title;
    container.appendChild(titleElement);
  }

  if (info.detail) {
    const detailElement = document.createElement('div');
    detailElement.className = 'error-message__detail';
    detailElement.textContent = info.detail;
    container.appendChild(detailElement);
  }

  if (info.raw) {
    const rawElement = document.createElement('div');
    rawElement.className = 'error-message__raw';
    rawElement.textContent = `详细信息：${info.raw}`;
    container.appendChild(rawElement);
  }

  contentDiv.innerHTML = '';
  contentDiv.appendChild(container);
}
 

// 存储页面内容和选中内容
let pageContent = null;
let selectedContent = null;

// 当前对话的原始文档内容（用于会话持久化）
let currentDocumentContext = '';

// 当前内存中加载的会话所对应的 URL（与浏览器当前 tab 的 URL 解耦）
let currentSessionUrl = null;

// 当前内存中加载的会话 ID（用于精确保存/切换）
let currentSessionId = null;

// 当前选中/页面上下文来源 URL（避免跨会话污染）
let contextSourceUrl = null;

// 自动命名进行中的会话（避免重复并发请求）
const sessionAutoNamingInFlight = new Set();

// 分组折叠状态（key: 分组显示名）
const sessionGroupCollapsedState = {};

/**
 * 显示选中内容区域
 */
async function showSelectedContent(text, isPageContent = false, contentType = null, sourceUrl = null) {
  const tag = document.getElementById('selected-content-tag');
  const preview = document.getElementById('selected-content-preview');
  const label = tag?.querySelector('.selected-content-label');
  const inputContainer = document.querySelector('.input-container');
  
  if (tag && preview) {
    if (!isPageContent) {
      // 真实的选中内容，清除页面内容，优先使用选中内容
      pageContent = null;
      
      // 生成预览文本（显示前后几个字符，中间用省略号）
      let previewText;
      if (text.length > 12) {
        const startText = text.substring(0, 4);
        const endText = text.substring(text.length - 4);
        previewText = `${startText}...${endText}`;
      } else {
        previewText = text;
      }
      preview.textContent = previewText;
      
      // 获取国际化文本
      try {
        const currentLang = await window.i18n.getCurrentLanguage();
        const messages = await window.i18n.getMessages(['selected_text'], currentLang);
        if (label) label.textContent = messages.selected_text || 'Selected Text';
      } catch (error) {
        // 回退到默认文本
        if (label) label.textContent = 'Selected Text';
      }
      
      tag.style.display = 'flex';
      if (inputContainer) inputContainer.classList.add('has-selected-content');
      
      // 给主容器添加类，用于调整导航栏位置
      const mainContent = document.querySelector('.my-extension-content');
      if (mainContent) mainContent.classList.add('has-selected-content-active');
      
      selectedContent = text;
      contextSourceUrl = sourceUrl || null;
    } else {
      // 页面内容：如果没有选中内容，将页面内容作为"选中内容"显示
      if (!selectedContent) {
        pageContent = text;
        
        // 生成页面内容的预览文本
        let previewText;
        // 提取页面文本的前几个有效字符（跳过HTML标签和空白）
        const cleanText = text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
        if (cleanText.length > 12) {
          const startText = cleanText.substring(0, 4);
          const endText = cleanText.substring(cleanText.length - 4);
          previewText = `${startText}...${endText}`;
        } else {
          previewText = cleanText;
        }
        preview.textContent = previewText;
        
        // 根据内容类型显示不同的标签
        try {
          const currentLang = await window.i18n.getCurrentLanguage();
          let labelKey = 'page_content_text';
          
          // 根据contentType确定标签
          if (contentType === 'video') {
            labelKey = 'video_subtitles';
          } else if (contentType === 'pdf') {
            labelKey = 'pdf_content';
          }
          
          const messages = await window.i18n.getMessages([labelKey], currentLang);
          let labelText = messages[labelKey];
          
          // 回退文本
          if (!labelText) {
            switch (contentType) {
              case 'video':
                labelText = currentLang === 'zh-CN' ? '视频字幕' : 'Video Subtitles';
                break;
              case 'pdf':
                labelText = currentLang === 'zh-CN' ? 'PDF内容' : 'PDF Content';
                break;
              default:
                labelText = currentLang === 'zh-CN' ? '页面内容' : 'Page Content';
            }
          }
          
          if (label) label.textContent = labelText;
        } catch (error) {
          // 回退到默认文本
          if (label) {
            switch (contentType) {
              case 'video':
                label.textContent = 'Video Subtitles';
                break;
              case 'pdf':
                label.textContent = 'PDF Content';
                break;
              default:
                label.textContent = 'Page Content';
            }
          }
        }
        
        tag.style.display = 'flex';
        if (inputContainer) inputContainer.classList.add('has-selected-content');
        
        // 给主容器添加类，用于调整导航栏位置
        const mainContent = document.querySelector('.my-extension-content');
        if (mainContent) mainContent.classList.add('has-selected-content-active');
        contextSourceUrl = sourceUrl || null;
      }
    }
  }
}

async function handleSubmitAction() {
  const userInput = document.getElementById('my-extension-user-input');
  const submitButton = document.getElementById('my-extension-submit-btn');
  const modelSelection = document.getElementById('model-selection');

  if (!userInput || !submitButton || !modelSelection) {
    return;
  }

  try {
    const selectedOption = modelSelection.options[modelSelection.selectedIndex];
    if (!selectedOption) {
      displayErrorMessage(new Error('当前未选择模型'), {
        context: '发送消息',
        defaultMessage: '请先选择一个模型后再发送。'
      });
      return;
    }

    const model = modelSelection.value;
    const provider = selectedOption.dataset.provider || '';
    if (!provider) {
      displayErrorMessage(new Error('当前模型缺少 provider 信息'), {
        context: '发送消息',
        defaultMessage: '模型配置尚未准备好，请刷新侧边栏后重试。'
      });
      return;
    }

    const apiKeyValid = await verifyApiKeyConfigured(provider);
    if (!apiKeyValid) {
      return;
    }
    if (userInput.value.trim() === '') {
      return;
    }

    hideRecommandContent();

    const originalUserText = userInput.value;
    let inputText = originalUserText;

    const contextContent = getCurrentContextContent();
    if (contextContent) {
      inputText = `关于文档中的这段内容：\n\n${contextContent}\n\n---\n\n${inputText}`;
    }

    const images = document.querySelectorAll('.uploaded-image-preview');
    const base64Images = [];
    images.forEach(img => {
      const imageBase64 = img.getAttribute('data-base64');
      if (imageBase64) {
        base64Images.push(imageBase64);
      }
    });

    if (contextContent) {
      const contentDiv = document.querySelector('.chat-content');
      const selectedTextDiv = document.createElement('div');
      selectedTextDiv.className = 'user-message selected-text-message';

      let labelText = '选中的内容:';
      try {
        const currentLang = await window.i18n.getCurrentLanguage();
        const messages = await window.i18n.getMessages(['selected_content_label'], currentLang);
        labelText = messages.selected_content_label || '选中的内容:';
      } catch (error) {}

      selectedTextDiv.innerHTML = `
        <div class="message-label">${labelText}</div>
        <div class="message-content">${contextContent}</div>
      `;
      contentDiv.appendChild(selectedTextDiv);
    }

    const userQuestionDiv = document.createElement('div');
    userQuestionDiv.className = 'user-message';
    let userMessage = '';
    if (base64Images) {
      base64Images.forEach(url => {
        if(!url.includes('image')) {
          url = DEFAULT_FILE_LOGO_PATH;
        }
        userMessage += "<img src='"+ url +"' />";
      });
    }
    userMessage += originalUserText;
    userQuestionDiv.innerHTML = userMessage;

    const editButton = document.createElement('button');
    editButton.className = 'edit-message-btn';
    editButton.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
      </svg>
    `;
    editButton.onclick = () => editUserMessage(userQuestionDiv, originalUserText);
    userQuestionDiv.appendChild(editButton);

    const contentDiv = document.querySelector('.chat-content');
    contentDiv.appendChild(userQuestionDiv);

    let newInputText = '';
    if(inputText.startsWith(SHORTCUT_SUMMAY)) {
      newInputText = SUMMARY_PROMPT + inputText.replace(SHORTCUT_SUMMAY, '') ;
    } else if(inputText.startsWith(SHORTCUT_DICTION)) {
      const dictionPrompt = await getDictionPrompt();
      newInputText = dictionPrompt + inputText.replace(SHORTCUT_DICTION, '') ;
    } else if(inputText.startsWith(SHORTCUT_TRANSLATION)) {
      const threeStepsTransPrompt = await getThreeStepsTransPrompt();
      newInputText = threeStepsTransPrompt + inputText.replace(SHORTCUT_TRANSLATION, '') ;
    } else if(inputText.startsWith(SHORTCUT_POLISH)) {
      newInputText = TEXT_POLISH_PROMTP + inputText.replace(SHORTCUT_POLISH, '');
    } else if(inputText.startsWith(SHORTCUT_CODE_EXPLAIN)) {
      newInputText = CODE_EXPLAIN_PROMTP + inputText.replace(SHORTCUT_CODE_EXPLAIN, '');
    } else if(inputText.startsWith(SHORTCUT_IMAGE2TEXT)) {
      newInputText = IMAGE2TEXT_PROMPT + inputText.replace(SHORTCUT_IMAGE2TEXT, '');
    } else {
      newInputText = inputText;
    }

    contentDiv.scrollTop = contentDiv.scrollHeight;
    userInput.value = "";

    const previewArea = document.querySelector('.image-preview-area');
    previewArea.innerHTML = '';
    updatePreviewAreaVisibility();
    hideSelectedContent();

    chatLLMAndUIUpdate(model, provider, newInputText, base64Images);
  } catch (error) {
    console.error('Submit action failed:', error);
    displayErrorMessage(error, {
      context: '发送消息',
      defaultMessage: '发送失败，请刷新侧边栏后重试。'
    });
  } finally {
    updateSubmitButton();
  }
}

/**
 * 隐藏选中内容区域
 */
function hideSelectedContent() {
  const tag = document.getElementById('selected-content-tag');
  const inputContainer = document.querySelector('.input-container');
  
  if (tag) {
    tag.style.display = 'none';
    if (inputContainer) inputContainer.classList.remove('has-selected-content');
    
    // 移除主容器的类
    const mainContent = document.querySelector('.my-extension-content');
    if (mainContent) mainContent.classList.remove('has-selected-content-active');
    

    // 清除所有内容：包括选中内容和页面内容
    selectedContent = null;
    pageContent = null;
    contextSourceUrl = null;
  }
}

/**
 * 获取当前上下文内容（用于与AI对话）
 */
function getCurrentContextContent() {
  if (contextSourceUrl && currentSessionUrl && contextSourceUrl !== currentSessionUrl) {
    return '';
  }
  // 优先使用选中内容，其次使用页面内容
  return selectedContent || pageContent || '';
}

/**
 * 主动请求当前页面的选中内容状态
 */
async function requestCurrentPageState() {
  try {
    // 向当前活动tab发送消息，请求页面状态
    const tabs = await chrome.tabs.query({active: true, currentWindow: true});
    if (tabs[0]) {
      chrome.tabs.sendMessage(tabs[0].id, {
        action: 'getCurrentPageState'
      }).catch(err => {
        console.log('[FisherAI] 请求页面状态失败:', err);
      });
    }
  } catch (error) {
    console.log('[FisherAI] 请求页面状态异常:', error);
  }
}

/**
 * 获取当前活动 tab
 */
async function _getCurrentActiveTab() {
  return new Promise(resolve => {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

/**
 * 自动保存当前会话（非阻塞）
 * 使用 currentSessionUrl（不依赖浏览器 tab URL），避免 tab 切换导致的 URL 错位
 */
async function _autoSaveCurrentSession() {
  try {
    if (!currentSessionUrl) {
      const tab = await _getCurrentActiveTab();
      currentSessionUrl = tab && tab.url ? tab.url : null;
      if (!currentSessionUrl) return;
    }
    if (!dialogueHistory || dialogueHistory.length <= 1) return;

    // 仅当活动 tab URL 与 currentSessionUrl 相同时，才更新标题
    let title = null;
    try {
      const tab = await _getCurrentActiveTab();
      if (tab && tab.url === currentSessionUrl) {
        title = tab.title;
      }
    } catch (e) { /* tab 获取失败，沿用已存标题 */ }

    const savedId = await saveCurrentSession(
      currentSessionUrl,
      title,
      dialogueHistory,
      geminiDialogueHistory,
      currentDocumentContext,
      currentSessionId
    );
    if (savedId) {
      currentSessionId = savedId;
    }
    updateSessionBar();
  } catch (e) {
    console.debug('_autoSaveCurrentSession skipped:', e && e.message);
  }
}

/**
 * 创建同页空白会话，并立即落盘生成新 session id
 */
async function _createBlankSessionForCurrentTab() {
  try {
    const tab = await _getCurrentActiveTab();
    if (tab && tab.url) {
      currentSessionUrl = tab.url;
    }
  } catch (e) { /* ignore */ }

  if (!currentSessionUrl) {
    return;
  }

  currentSessionId = null;
  initChatHistory();
  currentDocumentContext = '';
  hideSelectedContent();
  _renderRestoredHistory([]);

  let title = null;
  try {
    const tab = await _getCurrentActiveTab();
    if (tab && tab.url === currentSessionUrl) {
      title = tab.title || null;
    }
  } catch (e) { /* ignore */ }

  const newSessionId = await saveCurrentSession(
    currentSessionUrl,
    title,
    dialogueHistory,
    geminiDialogueHistory,
    currentDocumentContext,
    null
  );
  if (newSessionId) {
    currentSessionId = newSessionId;
  }

  updateSessionBar();
}

function _extractMessageText(content) {
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map(part => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
        if (part.type === 'input_text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (content && typeof content === 'object') {
    if (typeof content.text === 'string') {
      return content.text;
    }
    try {
      return JSON.stringify(content);
    } catch (e) {
      return '';
    }
  }
  return '';
}

function _looksLikeUrl(value) {
  if (!value || typeof value !== 'string') {
    return false;
  }
  try {
    const parsed = new URL(value);
    return !!parsed.protocol && !!parsed.host;
  } catch (e) {
    return false;
  }
}

function _compactUrl(urlValue) {
  if (!urlValue) {
    return '';
  }
  try {
    const parsed = new URL(urlValue);
    const rawPath = decodeURIComponent(parsed.pathname || '/');
    const path = rawPath === '/' ? '' : rawPath.replace(/\/+$/, '');
    return `${parsed.hostname}${path}`;
  } catch (e) {
    return String(urlValue);
  }
}

function _normalizeSessionText(text) {
  if (!text) {
    return '';
  }
  let cleaned = String(text);
  const sep = cleaned.indexOf('\n\n---\n\n');
  if (sep >= 0) {
    cleaned = cleaned.slice(sep + 7);
  }
  cleaned = cleaned
    .replace(/^关于文档中的这段内容：[\s\S]*$/m, '')
    .replace(/[*_`>#~]/g, ' ')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned;
}

function _extractLastUserPrompt(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'user') {
      continue;
    }
    const text = _normalizeSessionText(_extractMessageText(msg.content));
    if (text && text.length > 1) {
      return text;
    }
  }
  return '';
}

function _truncateLabel(text, maxLen = 60) {
  if (!text) {
    return '';
  }
  if (text.length <= maxLen) {
    return text;
  }
  return `${text.slice(0, maxLen - 1)}…`;
}

function _extractPaperIdentifierFromUrl(urlValue) {
  if (!urlValue || typeof urlValue !== 'string') {
    return '';
  }
  try {
    const url = new URL(urlValue);
    const href = `${url.origin}${url.pathname}${url.search}`;

    const arxiv = href.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i);
    if (arxiv && arxiv[1]) {
      return `arXiv:${arxiv[1]}`;
    }

    const doi = href.match(/doi\.org\/(10\.[^/?#]+)/i);
    if (doi && doi[1]) {
      return `DOI:${decodeURIComponent(doi[1])}`;
    }

    const openreview = href.match(/openreview\.net\/(?:forum|pdf)\?id=([^&#]+)/i);
    if (openreview && openreview[1]) {
      return `OpenReview:${decodeURIComponent(openreview[1])}`;
    }

    const acl = href.match(/aclanthology\.org\/([A-Za-z0-9.\-]+)/i);
    if (acl && acl[1]) {
      return `ACL:${acl[1]}`;
    }
  } catch (e) {
    return '';
  }
  return '';
}

function _cleanupPaperTitle(rawTitle) {
  if (!rawTitle || typeof rawTitle !== 'string') {
    return '';
  }
  let t = rawTitle
    .replace(/\s+/g, ' ')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .trim();
  if (!t) {
    return '';
  }
  if (_looksLikeUrl(t)) {
    return '';
  }

  const blocked = [
    /fisherai web copilot/i,
    /^new session$/i,
    /^untitled$/i
  ];
  if (blocked.some((p) => p.test(t))) {
    return '';
  }

  const suffixPatterns = [
    /\s*[-|—]\s*arxiv[:\s].*$/i,
    /\s*[-|—]\s*openreview.*$/i,
    /\s*[-|—]\s*google scholar.*$/i,
    /\s*[-|—]\s*acm digital library.*$/i,
    /\s*[-|—]\s*ieee xplore.*$/i,
    /\s*[-|—]\s*springer.*$/i,
    /\s*[-|—]\s*semantic scholar.*$/i,
    /\s*[-|—]\s*youtube.*$/i,
    /\s*[-|—]\s*bilibili.*$/i
  ];
  suffixPatterns.forEach((p) => {
    t = t.replace(p, '').trim();
  });

  // Generic title split fallback
  const splitters = [' | ', ' - ', ' — '];
  for (const s of splitters) {
    if (t.includes(s)) {
      const head = t.split(s)[0].trim();
      if (head.length >= 8) {
        t = head;
        break;
      }
    }
  }

  if (t.length < 6) {
    return '';
  }
  return t;
}

function _extractPaperLabel(session) {
  if (!session) {
    return '';
  }
  const fromTitle = _cleanupPaperTitle(session.title || '');
  if (fromTitle) {
    return fromTitle;
  }
  return _extractPaperIdentifierFromUrl(session.url || '');
}

function _isLlmNamingSupportedProvider(provider) {
  if (!provider) return false;
  if (provider.includes(PROVIDER_GOOGLE)) return false;
  if (provider.includes(PROVIDER_OLLAMA)) return false;
  if (provider.includes(PROVIDER_FISHERAI)) return false;
  return true;
}

function _extractAssistantResponseForNaming(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') continue;
    const text = _normalizeSessionText(_extractMessageText(msg.content));
    if (text && text.length > 8) {
      return text;
    }
  }
  return '';
}

function _buildSessionNamingContext(session) {
  const paperLabel = _extractPaperLabel(session);
  const urlId = _extractPaperIdentifierFromUrl(session?.url || '');
  const lastUser = _extractLastUserPrompt(session?.history || []);
  const lastAssistant = _extractAssistantResponseForNaming(session?.history || []);
  const blocks = [
    paperLabel ? `Paper hint: ${paperLabel}` : '',
    urlId ? `Identifier: ${urlId}` : '',
    lastUser ? `User query: ${_truncateLabel(lastUser, 280)}` : '',
    lastAssistant ? `Assistant summary: ${_truncateLabel(lastAssistant, 520)}` : ''
  ].filter(Boolean);
  return blocks.join('\n');
}

function _extractOpenAIStyleMessageContent(content) {
  if (!content) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part) return '';
        if (typeof part === 'string') return part;
        if (typeof part.text === 'string') return part.text;
        if (part.type === 'text' && typeof part.text === 'string') return part.text;
        return '';
      })
      .filter(Boolean)
      .join(' ');
  }
  if (typeof content === 'object' && typeof content.text === 'string') {
    return content.text;
  }
  return '';
}

function _sanitizeGeneratedSessionName(raw) {
  if (!raw) return '';
  let name = String(raw)
    .replace(/^["'`“”‘’]+|["'`“”‘’]+$/g, '')
    .replace(/^[\s\-*#>]+/, '')
    .replace(/^(title|题目|论文题目)\s*[:：]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!name) return '';
  if (_looksLikeUrl(name)) return '';
  if (_isGenericSessionPrompt(name)) return '';

  return _truncateLabel(name, 40);
}

async function _requestSessionNameByLlm(session, model, provider) {
  if (!_isLlmNamingSupportedProvider(provider)) {
    return '';
  }
  const context = _buildSessionNamingContext(session);
  if (!context) {
    return '';
  }

  const { baseUrl, apiKey } = await getProviderBaseUrlAndApiKey(provider);
  if (!baseUrl) {
    return '';
  }

  const endpoint = baseUrl;
  const systemPrompt = [
    'You are a title generator for research-paper chat sessions.',
    'Generate exactly ONE concise title (max 18 Chinese chars or max 8 English words).',
    'Prioritize the paper/topic identity over generic actions.',
    'No quotes. No punctuation at the end. No extra explanation.'
  ].join(' ');
  const userPrompt = `Context:\n${context}\n\nReturn title only.`;

  const body = {
    model,
    stream: false,
    max_tokens: 48,
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ]
  };

  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const resp = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal
    });
    if (!resp.ok) {
      return '';
    }
    const data = await resp.json();
    const raw = _extractOpenAIStyleMessageContent(data?.choices?.[0]?.message?.content);
    return _sanitizeGeneratedSessionName(raw);
  } catch (e) {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function _maybeAutoGenerateSessionName(model, provider) {
  const sessionId = currentSessionId;
  if (!sessionId || sessionAutoNamingInFlight.has(sessionId)) {
    return;
  }

  const session = await getSessionById(sessionId);
  if (!session) return;
  if (session.name && String(session.name).trim()) return;
  if (!Array.isArray(session.history) || session.history.length < 3) return;
  if (!_extractAssistantResponseForNaming(session.history)) return;

  sessionAutoNamingInFlight.add(sessionId);
  try {
    let name = await _requestSessionNameByLlm(session, model, provider);
    if (!name) {
      name = _extractPaperLabel(session) || _extractAssistantHint(session);
      name = _sanitizeGeneratedSessionName(name);
    }
    if (!name) {
      return;
    }

    // Avoid overriding user-typed names during async generation.
    const latest = await getSessionById(sessionId);
    if (!latest || (latest.name && String(latest.name).trim())) {
      return;
    }

    await renameSession(sessionId, name);
    if (currentSessionId === sessionId) {
      updateSessionBar();
    }
    const dropdown = document.getElementById('session-dropdown');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      renderSessionList();
    }
  } catch (e) {
    // silent
  } finally {
    sessionAutoNamingInFlight.delete(sessionId);
  }
}

function _formatSessionClock(ts) {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function _isGenericSessionPrompt(text) {
  if (!text) {
    return true;
  }
  const t = String(text).trim();
  if (!t) {
    return true;
  }
  const head = t.slice(0, 220);
  const genericPatterns = [
    /请根据以下结构总结.*论文/i,
    /研究背景/i,
    /核心工作与贡献/i,
    /一句话总结/i,
    /极简总结句/i,
    /中英文双语/i,
    /请你是论文作者助手/i,
    /生成一份论文要点速览/i,
    /^请根据以下/i,
    /^你现在是/i,
    /^you are/i,
    /summarize .*paper/i
  ];
  return genericPatterns.some((p) => p.test(head));
}

function _extractAssistantHint(history) {
  if (!Array.isArray(history) || history.length === 0) {
    return '';
  }
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (!msg || msg.role !== 'assistant') {
      continue;
    }
    const raw = _normalizeSessionText(_extractMessageText(msg.content));
    if (!raw) {
      continue;
    }
    const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
    for (const line of lines) {
      const cleaned = line
        .replace(/^[-*#>\d.)\s]+/, '')
        .replace(/^[:：]\s*/, '')
        .trim();
      if (cleaned.length < 6) {
        continue;
      }
      if (/^(一句话总结|极简总结句|研究背景|核心工作|要求|中文|english)$/i.test(cleaned)) {
        continue;
      }
      if (_isGenericSessionPrompt(cleaned)) {
        continue;
      }
      return cleaned;
    }
  }
  return '';
}

function _getSessionDisplayLabel(session, i18n = {}) {
  if (!session) {
    return i18n.untitled || 'Untitled';
  }

  if (session.name && String(session.name).trim()) {
    return String(session.name).trim();
  }

  const paperLabel = _extractPaperLabel(session);
  if (paperLabel) {
    return _truncateLabel(paperLabel, 64);
  }

  const userPrompt = _extractLastUserPrompt(session.history);
  if (userPrompt && !_isGenericSessionPrompt(userPrompt)) {
    return _truncateLabel(userPrompt, 64);
  }

  const assistantHint = _extractAssistantHint(session.history);
  if (assistantHint) {
    return _truncateLabel(assistantHint, 64);
  }

  if (session.title && !_looksLikeUrl(session.title)) {
    return _truncateLabel(session.title, 64);
  }

  if (userPrompt) {
    return _truncateLabel(userPrompt, 64);
  }

  if (session.url) {
    return _truncateLabel(_compactUrl(session.url), 64);
  }

  return i18n.untitled || 'Untitled';
}

function _toCanonicalSessionGroup(groupName, i18n = {}) {
  const raw = typeof groupName === 'string' ? groupName.trim() : '';
  if (!raw) {
    return 'Default';
  }
  const lowered = raw.toLowerCase();
  if (lowered === 'default') {
    return 'Default';
  }
  const localizedDefault = (i18n.default_group || '').trim().toLowerCase();
  if (localizedDefault && lowered === localizedDefault) {
    return 'Default';
  }
  if (raw === '默认分组') {
    return 'Default';
  }
  return raw;
}

function _getSessionGroupDisplayName(session, i18n = {}) {
  const canonical = _toCanonicalSessionGroup(session && session.group ? session.group : '', i18n);
  if (canonical === 'Default') {
    return i18n.default_group || 'Default';
  }
  return canonical;
}

function _groupSessionsByGroup(sessions, i18n = {}) {
  const grouped = new Map();
  sessions.forEach((session) => {
    const groupName = _getSessionGroupDisplayName(session, i18n);
    if (!grouped.has(groupName)) {
      grouped.set(groupName, []);
    }
    grouped.get(groupName).push(session);
  });

  const defaultName = i18n.default_group || 'Default';
  const groupNames = Array.from(grouped.keys()).sort((a, b) => {
    if (a === defaultName && b !== defaultName) return -1;
    if (b === defaultName && a !== defaultName) return 1;
    return a.localeCompare(b, 'zh-Hans-CN');
  });

  return { grouped, groupNames };
}

function _isSessionGroupCollapsed(groupName) {
  return !!sessionGroupCollapsedState[groupName];
}

function _setSessionGroupCollapsed(groupName, collapsed) {
  sessionGroupCollapsedState[groupName] = !!collapsed;
}

/**
 * 渲染已恢复的历史对话到 UI
 * 跳过 system prompt (index 0) 及大型文档消息 (index 1)
 */
function _renderRestoredHistory(history) {
  const contentDiv = document.querySelector('.chat-content');
  if (!contentDiv) return;

  // 无论如何先清空当前内容
  contentDiv.innerHTML = '';

  if (!history || history.length === 0) {
    showRecommandContent();
    return;
  }

  // 跳过系统 prompt；若 index 1 是大文档消息也跳过
  let startIdx = 1;
  if (history.length > 1 && history[1].role === 'user') {
    const c = typeof history[1].content === 'string' ? history[1].content : '';
    if (estimateTokens(c) > 1000) startIdx = 2;
  }

  let renderedCount = 0;
  const appendRestoredToolMessage = (msg) => {
    const rawContent = typeof msg.content === 'string' ? msg.content.trim() : '';
    if (!rawContent) return false;

    let parsed;
    try {
      parsed = JSON.parse(rawContent);
    } catch (error) {
      return false;
    }

    const result = parsed?.result || null;
    const status = parsed?.status || '';

    const aiDiv = document.createElement('div');
    aiDiv.className = 'ai-message';
    aiDiv.dataset.toolMessage = 'true';
    contentDiv.appendChild(aiDiv);

    if (result?.markdown) {
      if (parsed.query) {
        const toolCard = createToolCallCard({
          type: 'jina-search',
          titleText: getToolLocaleText('tool_jina_search_title'),
          statusText: status === 'success' ? getToolLocaleText('tool_jina_search_success') : getToolLocaleText('tool_common_failed'),
          collapsible: true,
          startCollapsed: true
        });
        aiDiv.appendChild(toolCard.card);
        if (status === 'success') {
          renderJinaSearchResults(toolCard.bodyEl, result);
          updateToolCardStatus(toolCard.statusEl, getToolLocaleText('tool_jina_search_success'), 'is-success');
        } else {
          renderToolCardError(toolCard.bodyEl, parsed.message || rawContent);
          updateToolCardStatus(toolCard.statusEl, getToolLocaleText('tool_common_failed'), 'is-error');
        }
      } else {
        const toolCard = createToolCallCard({
          type: 'jina-reader',
          titleText: getToolLocaleText('tool_jina_reader_title'),
          statusText: status === 'success' ? getToolLocaleText('tool_jina_reader_success') : getToolLocaleText('tool_common_failed'),
          collapsible: true,
          startCollapsed: true
        });
        aiDiv.appendChild(toolCard.card);
        if (status === 'success') {
          renderJinaReaderResults(toolCard.bodyEl, result);
          updateToolCardStatus(toolCard.statusEl, getToolLocaleText('tool_jina_reader_success'), 'is-success');
        } else {
          renderToolCardError(toolCard.bodyEl, parsed.message || rawContent);
          updateToolCardStatus(toolCard.statusEl, getToolLocaleText('tool_common_failed'), 'is-error');
        }
      }
      renderedCount += 1;
      return true;
    }

    if (result?.answerBox || Array.isArray(result?.organicResults)) {
      const toolCard = createToolCallCard({
        type: 'serpapi',
        titleText: getToolLocaleText('tool_serpapi_title'),
        statusText: status === 'success' ? getToolLocaleText('tool_serpapi_success') : getToolLocaleText('tool_common_failed'),
        collapsible: true,
        startCollapsed: true
      });
      aiDiv.appendChild(toolCard.card);
      if (status === 'success') {
        renderSerpApiResults(toolCard.bodyEl, result, parsed.query || '');
        updateToolCardStatus(toolCard.statusEl, getToolLocaleText('tool_serpapi_success'), 'is-success');
      } else {
        renderToolCardError(toolCard.bodyEl, parsed.message || rawContent);
        updateToolCardStatus(toolCard.statusEl, getToolLocaleText('tool_common_failed'), 'is-error');
      }
      renderedCount += 1;
      return true;
    }

    contentDiv.removeChild(aiDiv);
    return false;
  };

  const appendMessage = (msg) => {
    if (!msg || !msg.role) return;
    if (msg.role === 'user') {
      const userDiv = document.createElement('div');
      userDiv.className = 'user-message';
      const c = _extractMessageText(msg.content);
      const sep = c.indexOf('\n\n---\n\n');
      userDiv.textContent = sep >= 0 ? c.slice(sep + 7) : c;
      if (userDiv.textContent && userDiv.textContent.trim().length > 0) {
        contentDiv.appendChild(userDiv);
        renderedCount += 1;
      }
      return;
    }

    if (msg.role === 'assistant' || msg.role === 'tool') {
      if (msg.role === 'tool' && appendRestoredToolMessage(msg)) {
        return;
      }
      const content = _extractMessageText(msg.content);
      if (!content || content.trim().length === 0) return;
      const aiDiv = document.createElement('div');
      aiDiv.className = 'ai-message';
      contentDiv.appendChild(aiDiv);
      renderMarkdownWithMath(content, aiDiv);
      createCopyButton(content);
      renderedCount += 1;
    }
  };

  for (let i = startIdx; i < history.length; i++) {
    const msg = history[i];
    appendMessage(msg);
  }

  // 兜底：若常规渲染为空，再从非 system 消息全量尝试一次
  if (renderedCount === 0 && history.length > 1) {
    for (let i = 1; i < history.length; i++) {
      appendMessage(history[i]);
    }
  }

  if (renderedCount > 0) {
    hideRecommandContent();
    contentDiv.scrollTop = contentDiv.scrollHeight;
  } else {
    showRecommandContent();
  }
}

// ─── Session Bar ─────────────────────────────────────────────────────────────

/**
 * 初始化 session bar（点击展开/收起下拉）
 */
function initSessionBar() {
  const bar = document.getElementById('session-bar');
  if (!bar) return;

  const current = document.getElementById('session-current');
  const dropdown = document.getElementById('session-dropdown');
  if (!current || !dropdown) return;

  current.addEventListener('click', () => {
    dropdown.classList.toggle('hidden');
    if (!dropdown.classList.contains('hidden')) {
      renderSessionList();
    }
  });

  // 点击外部关闭下拉
  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target)) {
      dropdown.classList.add('hidden');
    }
  });

  updateSessionBar();
}

/**
 * 更新 session bar 标题文字
 */
async function updateSessionBar() {
  const titleEl = document.getElementById('session-title-text');
  if (!titleEl) return;
  try {
    const i18n = window._sessionI18n || {};
    const session = currentSessionId ? await getSessionById(currentSessionId) : null;
    if (session) {
      titleEl.textContent = _getSessionDisplayLabel(session, i18n);
    } else if (currentSessionUrl) {
      titleEl.textContent = i18n.new_session || 'New Session';
    } else {
      titleEl.textContent = i18n.untitled || 'Untitled';
    }
  } catch (e) {
    // 静默失败
  }
}

/**
 * 渲染 session 下拉列表
 */
async function renderSessionList() {
  const list = document.getElementById('session-list');
  if (!list) return;
  list.innerHTML = '';

  const sessions = await getAllSessions();
  const i18n = window._sessionI18n || {};
  const defaultGroupName = i18n.default_group || 'Default';

  const newSessionItem = document.createElement('div');
  newSessionItem.className = 'session-item session-item-new';
  newSessionItem.textContent = `+ ${i18n.new_session || 'New Session'}`;
  newSessionItem.addEventListener('click', async () => {
    await _autoSaveCurrentSession();
    await _createBlankSessionForCurrentTab();
    document.getElementById('session-dropdown').classList.add('hidden');
  });
  list.appendChild(newSessionItem);

  const newGroupItem = document.createElement('div');
  newGroupItem.className = 'session-item session-item-new';
  newGroupItem.textContent = `+ ${i18n.new_group || 'New Group'}`;
  newGroupItem.addEventListener('click', async () => {
    const groupName = await askSessionTextInput(
      i18n.new_group_prompt || 'Input new group name',
      '',
      {
        placeholder: i18n.new_group_placeholder || 'Group name',
        confirmText: i18n.confirm || 'OK',
        cancelText: i18n.cancel || 'Cancel',
        allowEmpty: false
      }
    );
    if (!groupName) return;
    await _autoSaveCurrentSession();
    await _createBlankSessionForCurrentTab();
    if (currentSessionId) {
      await setSessionGroup(currentSessionId, groupName);
    }
    renderSessionList();
    updateSessionBar();
    document.getElementById('session-dropdown').classList.add('hidden');
  });
  list.appendChild(newGroupItem);

  if (sessions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'session-item session-empty';
    empty.textContent = i18n.empty || 'No sessions';
    list.appendChild(empty);
    return;
  }

  const baseLabelById = new Map();
  const labelCount = new Map();
  sessions.forEach((session) => {
    const base = _getSessionDisplayLabel(session, i18n);
    baseLabelById.set(session.id, base);
    labelCount.set(base, (labelCount.get(base) || 0) + 1);
  });

  const { grouped, groupNames } = _groupSessionsByGroup(sessions, i18n);

  for (const groupName of groupNames) {
    const header = document.createElement('div');
    header.className = 'session-group-header';
    const count = grouped.get(groupName)?.length || 0;
    const collapsed = _isSessionGroupCollapsed(groupName);

    const headerName = document.createElement('span');
    headerName.className = 'session-group-title';
    headerName.textContent = `${groupName} (${count})`;

    const headerActions = document.createElement('div');
    headerActions.style.display = 'inline-flex';
    headerActions.style.alignItems = 'center';
    headerActions.style.gap = '6px';

    if (groupName !== defaultGroupName) {
      const renameGroupBtn = document.createElement('button');
      renameGroupBtn.className = 'session-action-btn';
      renameGroupBtn.title = i18n.rename_group || 'Rename Group';
      renameGroupBtn.textContent = '✏️';
      renameGroupBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const nextName = await askSessionTextInput(
          i18n.rename_group || 'Rename Group',
          groupName,
          {
            placeholder: i18n.new_group_placeholder || 'Group name',
            confirmText: i18n.confirm || 'OK',
            cancelText: i18n.cancel || 'Cancel',
            allowEmpty: false
          }
        );
        if (!nextName || nextName === groupName) return;
        await renameSessionGroup(groupName, nextName);
        renderSessionList();
        updateSessionBar();
      });
      headerActions.appendChild(renameGroupBtn);
    }

    const toggleIcon = document.createElement('span');
    toggleIcon.className = 'session-group-toggle';
    toggleIcon.textContent = collapsed ? '▸' : '▾';

    header.appendChild(headerName);
    headerActions.appendChild(toggleIcon);
    header.appendChild(headerActions);
    list.appendChild(header);

    const groupBody = document.createElement('div');
    groupBody.className = 'session-group-body';
    if (collapsed) {
      groupBody.classList.add('collapsed');
    }
    list.appendChild(groupBody);

    header.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextCollapsed = !_isSessionGroupCollapsed(groupName);
      _setSessionGroupCollapsed(groupName, nextCollapsed);
      groupBody.classList.toggle('collapsed', nextCollapsed);
      toggleIcon.textContent = nextCollapsed ? '▸' : '▾';
    });

    const groupSessions = grouped.get(groupName) || [];
    for (const session of groupSessions) {
      const item = document.createElement('div');
      item.className = 'session-item';
      if (session.id === currentSessionId) {
        item.classList.add('active');
      }
      item.dataset.id = session.id;

      const infoDiv = document.createElement('div');
      infoDiv.className = 'session-item-info';

      const nameEl = document.createElement('div');
      nameEl.className = 'session-item-name';
      let displayName = baseLabelById.get(session.id) || _getSessionDisplayLabel(session, i18n);
      if (!session.name && (labelCount.get(displayName) || 0) > 1) {
        const suffix = _formatSessionClock(session.createdAt || session.updatedAt);
        if (suffix) {
          displayName = `${displayName} · ${suffix}`;
        }
      }
      nameEl.textContent = displayName;

      const timeEl = document.createElement('div');
      timeEl.className = 'session-item-time';
      timeEl.textContent = formatSessionTime(session.updatedAt);

      infoDiv.appendChild(nameEl);
      infoDiv.appendChild(timeEl);

      const moveBtn = document.createElement('button');
      moveBtn.className = 'session-action-btn session-move-btn';
      moveBtn.title = i18n.move_group || 'Move Group';
      moveBtn.innerHTML = '📁';
      moveBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const currentGroup = _toCanonicalSessionGroup(session.group, i18n);
        const suggested = currentGroup === 'Default' ? '' : currentGroup;
        const input = await askSessionTextInput(
          i18n.move_group || 'Move Group',
          suggested,
          {
            placeholder: i18n.new_group_placeholder || 'Group name',
            confirmText: i18n.confirm || 'OK',
            cancelText: i18n.cancel || 'Cancel',
            allowEmpty: true
          }
        );
        if (input === null) return;
        const targetGroup = _toCanonicalSessionGroup(input, i18n);
        await setSessionGroup(session.id, targetGroup || defaultGroupName);
        renderSessionList();
        updateSessionBar();
      });

      // 重命名按钮
      const renameBtn = document.createElement('button');
      renameBtn.className = 'session-action-btn session-rename-btn';
      renameBtn.title = i18n.rename || 'Rename';
      renameBtn.innerHTML = '✏️';
      renameBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const newName = await askSessionTextInput(
          i18n.rename || 'Rename',
          session.name || _getSessionDisplayLabel(session, i18n),
          {
            placeholder: i18n.rename || 'Rename',
            confirmText: i18n.confirm || 'OK',
            cancelText: i18n.cancel || 'Cancel',
            allowEmpty: true
          }
        );
        if (newName !== null) {
          await renameSession(session.id, newName.trim() || null);
          renderSessionList();
          updateSessionBar();
        }
      });

      // 删除按钮
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'session-action-btn session-delete-btn';
      deleteBtn.title = i18n.delete_session || 'Delete';
      deleteBtn.innerHTML = '🗑';
      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        await deleteSession(session.id);
        if (session.id === currentSessionId) {
          currentSessionId = null;
          currentDocumentContext = '';
          initChatHistory();
          hideSelectedContent();
          _renderRestoredHistory([]);
        }
        renderSessionList();
        updateSessionBar();
      });

      item.appendChild(infoDiv);
      item.appendChild(moveBtn);
      item.appendChild(renameBtn);
      item.appendChild(deleteBtn);

      // 点击切换到该会话（同步恢复 UI，异步保存旧会话）
      item.addEventListener('click', () => {
        if (session.id === currentSessionId) {
          document.getElementById('session-dropdown').classList.add('hidden');
          return;
        }

        // 1. 同步捕获旧会话状态
        const prevSessionId = currentSessionId;
        const prevUrl = currentSessionUrl;
        const prevHistory = dialogueHistory;
        const prevGeminiHistory = geminiDialogueHistory;
        const prevDocCtx = currentDocumentContext;

        // 2. 立即更新 currentSessionUrl 并恢复新会话（全部同步，UI 即时更新）
        currentSessionId = session.id;
        currentSessionUrl = session.url;
        restoreDialogueHistory(session.history, session.geminiHistory || []);
        currentDocumentContext = session.documentContext || '';
        hideSelectedContent();
        _renderRestoredHistory(session.history);
        document.getElementById('session-dropdown').classList.add('hidden');
        updateSessionBar();

        // 3. 后台保存旧会话（不阻塞切换）
        (async () => {
          try {
            if (prevUrl && prevHistory && prevHistory.length > 1) {
              await saveCurrentSession(prevUrl, null, prevHistory, prevGeminiHistory, prevDocCtx, prevSessionId);
            }
          } catch (e) {
            console.debug('Session save on switch:', e);
          }
        })();
      });

      groupBody.appendChild(item);
    }
  }
}

function askSessionTextInput(title, initialValue = '', options = {}) {
  const {
    placeholder = '',
    confirmText = 'OK',
    cancelText = 'Cancel',
    allowEmpty = true
  } = options;

  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.background = 'rgba(2, 6, 23, 0.7)';
    overlay.style.backdropFilter = 'blur(6px)';
    overlay.style.zIndex = '99999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.padding = '24px';

    const modal = document.createElement('div');
    modal.style.width = 'min(420px, calc(100vw - 32px))';
    modal.style.background = '#ffffff';
    modal.style.borderRadius = '16px';
    modal.style.boxShadow = '0 24px 60px rgba(15, 23, 42, 0.3)';
    modal.style.padding = '18px';
    modal.style.display = 'flex';
    modal.style.flexDirection = 'column';
    modal.style.gap = '12px';

    const heading = document.createElement('div');
    heading.textContent = title;
    heading.style.fontSize = '16px';
    heading.style.fontWeight = '700';
    heading.style.color = '#0f172a';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = initialValue || '';
    input.placeholder = placeholder;
    input.style.width = '100%';
    input.style.boxSizing = 'border-box';
    input.style.padding = '12px 14px';
    input.style.borderRadius = '12px';
    input.style.border = '1px solid #cbd5e1';
    input.style.outline = 'none';
    input.style.fontSize = '14px';
    input.style.color = '#0f172a';
    input.style.background = '#f8fafc';

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.justifyContent = 'flex-end';
    actions.style.gap = '10px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = cancelText;
    cancelBtn.style.padding = '10px 14px';
    cancelBtn.style.borderRadius = '10px';
    cancelBtn.style.border = '1px solid #cbd5e1';
    cancelBtn.style.background = '#ffffff';
    cancelBtn.style.color = '#334155';
    cancelBtn.style.cursor = 'pointer';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = confirmText;
    confirmBtn.style.padding = '10px 14px';
    confirmBtn.style.borderRadius = '10px';
    confirmBtn.style.border = 'none';
    confirmBtn.style.background = '#2563eb';
    confirmBtn.style.color = '#ffffff';
    confirmBtn.style.cursor = 'pointer';

    const cleanup = (value) => {
      overlay.remove();
      resolve(value);
    };

    cancelBtn.addEventListener('click', () => cleanup(null));
    confirmBtn.addEventListener('click', () => {
      const value = input.value.trim();
      if (!allowEmpty && !value) {
        input.focus();
        return;
      }
      cleanup(value);
    });
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) {
        cleanup(null);
      }
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmBtn.click();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        cleanup(null);
      }
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(confirmBtn);
    modal.appendChild(heading);
    modal.appendChild(input);
    modal.appendChild(actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    input.focus();
    input.select();
  });
}

/**
 * 主程序
 */
document.addEventListener('DOMContentLoaded', async function() {
  initResultPage();

  // 加载 session bar 国际化文字
  try {
    const lang = await window.i18n.getCurrentLanguage();
    const msgs = await window.i18n.getMessages([
      'chat_session_current', 'chat_session_rename', 'chat_session_delete',
      'chat_session_untitled', 'chat_session_new', 'chat_session_just_now', 'chat_session_empty',
      'chat_session_group_default', 'chat_session_move_group', 'chat_session_move_group_prompt',
      'chat_session_new_group', 'chat_session_new_group_prompt', 'chat_session_new_group_placeholder',
      'chat_session_rename_group', 'chat_session_confirm', 'chat_session_cancel'
    ], lang);
    window._sessionI18n = {
      current: msgs.chat_session_current || 'Current Session',
      rename: msgs.chat_session_rename || 'Rename',
      delete_session: msgs.chat_session_delete || 'Delete',
      untitled: msgs.chat_session_untitled || 'Untitled',
      new_session: msgs.chat_session_new || 'New Session',
      just_now: msgs.chat_session_just_now || 'Just now',
      empty: msgs.chat_session_empty || 'No sessions',
      default_group: msgs.chat_session_group_default || 'Default',
      move_group: msgs.chat_session_move_group || 'Move Group',
      move_group_prompt: msgs.chat_session_move_group_prompt || 'Input target group name (empty = Default)',
      new_group: msgs.chat_session_new_group || 'New Group',
      new_group_prompt: msgs.chat_session_new_group_prompt || 'Input new group name',
      new_group_placeholder: msgs.chat_session_new_group_placeholder || 'Group name',
      rename_group: msgs.chat_session_rename_group || 'Rename Group',
      confirm: msgs.chat_session_confirm || 'OK',
      cancel: msgs.chat_session_cancel || 'Cancel'
    };
  } catch (e) {
    window._sessionI18n = {};
  }

  // 添加清除按钮事件监听
  const clearBtn = document.getElementById('clear-selected-btn');
  if (clearBtn) {
    clearBtn.addEventListener('click', hideSelectedContent);
  }

  // 请求当前页面状态（选中内容或页面内容）
  setTimeout(() => {
    requestCurrentPageState();
  }, 500);

  // 加载当前 URL 的历史会话
  try {
    let url = null;
    const tab = await _getCurrentActiveTab();
    if (tab && tab.url) {
      url = tab.url;
    } else {
      url = await getCurrentURL();
    }
    currentSessionUrl = url;
    const sameUrlSessions = await getSessionsByUrl(url);
    const session = sameUrlSessions.find(s => s.history && s.history.length > 1) || sameUrlSessions[0] || null;
    if (session && session.history && session.history.length > 1) {
      currentSessionId = session.id;
      restoreDialogueHistory(session.history, session.geminiHistory || []);
      currentDocumentContext = session.documentContext || '';
      _renderRestoredHistory(session.history);
    } else {
      currentSessionId = null;
    }
  } catch (e) {
    // 无活动 tab 或无历史会话 — 正常情况
  }

  // 初始化 session bar
  initSessionBar();
});

// 监听来自content script的消息
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === 'sendSelectedTextToSidePanel') {
    showSelectedContent(message.selectedText, false, null, message.url || null);
    sendResponse({received: true});
  } else if (message.action === 'sendPageContentToSidePanel') {
    showSelectedContent(message.pageContent, true, message.contentType, message.url || null);
    sendResponse({received: true});
  } else if (message.action === 'clearSelectedTextFromSidePanel') {
    hideSelectedContent();
    sendResponse({received: true});
  }
  return true;
});

// 监听存储变化，当模型列表或提供商启用状态更新时刷新模型选择
chrome.storage.onChanged.addListener(function(changes, namespace) {
  if (namespace === 'sync') {
    // 检查是否有模型列表变化
    const modelChanges = Object.keys(changes).filter(key => key.endsWith('-models'));
    // 检查是否有提供商启用状态变化
    const providerEnabledChanges = Object.keys(changes).filter(key => key.endsWith('-enabled'));
    // 检查是否有模型提供商映射变化
    const mappingChange = changes['model-provider-mapping'];
    
    if (modelChanges.length > 0 || providerEnabledChanges.length > 0 || mappingChange) {
      // 如果有模型列表或提供商启用状态变化，重新加载模型选择
      populateModelSelections().catch(err => {
        console.error('Error updating model selections:', err);
      });
    }

    // 检查摘要提示词列表变化，刷新下拉框
    if (changes['summary_prompts_list']) {
      loadSummaryPromptsList(function(prompts) {
        const summaryPromptSelect = document.getElementById('summary-prompt-select');
        if (summaryPromptSelect) {
          const currentValue = summaryPromptSelect.value;
          summaryPromptSelect.innerHTML = '';
          prompts.forEach(function(p) {
            const option = document.createElement('option');
            option.value = p.id;
            option.textContent = p.name;
            option.dataset.prompt = p.prompt;
            summaryPromptSelect.appendChild(option);
          });
          // 恢复之前的选择
          const exists = Array.from(summaryPromptSelect.options).some(opt => opt.value === currentValue);
          if (exists) {
            summaryPromptSelect.value = currentValue;
          }
        }
      });
    }
  }
});


