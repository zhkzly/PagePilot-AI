// 存储视频ID对应的pot参数
const potCache = new Map();

// 监听网络请求以获取pot参数
chrome.webRequest.onBeforeRequest.addListener(
  function(details) {
    const url = new URL(details.url);
    const pot = url.searchParams.get('pot');
    const v = url.searchParams.get('v');
    
    if (pot && v) {
      potCache.set(v, pot);
    }
  },
  {
    urls: ["*://www.youtube.com/api/timedtext*"]
  }
);

chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  if (message.action === "openSettings") {
    chrome.tabs.create({'url': 'settings.html'});
  } else if (message.action === "getPageTitle") {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (chrome.runtime.lastError) {
        // 如果出现错误，返回错误信息
        sendResponse({title: null, error: chrome.runtime.lastError.message});
      } else if (tabs && tabs[0]) {
        sendResponse({title: tabs[0].title});
      } else {
        sendResponse({title: null});
      }
    });
    return true; // Keep the message channel open to send the response asynchronously
  } else if (message.action === "getPotParameter") {
    // 响应content script请求pot参数
    const pot = potCache.get(message.videoId);
    sendResponse({pot: pot});
    return true;
  } else if (message.action === "storePotParameter") {
    // 存储从页面拦截器获取的pot参数
    if (message.videoId && message.pot) {
      potCache.set(message.videoId, message.pot);
    }
    return true;
  } else if (message.action === "sendSelectedTextToSidePanel" || message.action === "sendPageContentToSidePanel" || message.action === "clearSelectedTextFromSidePanel") {
    // 转发选中文本、页面内容或清除选中内容到侧边栏
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0]) {
        // 向侧边栏发送消息
        chrome.runtime.sendMessage(message).catch(err => {
          // console.log('Failed to send message to side panel:', err);
        });
      }
    });
    return true;
  }
});

const SIDE_PANEL_PATH = 'side_panel.html';
const SIDE_PANEL_SCOPE_STORAGE_KEY = 'sidePanelTabByWindow';
const sidePanelTabByWindow = new Map();
let sidePanelScopeLoaded = false;

async function ensureSidePanelScopeLoaded() {
  if (sidePanelScopeLoaded) {
    return;
  }

  try {
    const stored = await chrome.storage.session.get(SIDE_PANEL_SCOPE_STORAGE_KEY);
    const raw = stored ? stored[SIDE_PANEL_SCOPE_STORAGE_KEY] : null;
    if (raw && typeof raw === 'object') {
      Object.entries(raw).forEach(([windowId, tabId]) => {
        const parsedWindowId = Number(windowId);
        if (Number.isInteger(parsedWindowId) && Number.isInteger(tabId)) {
          sidePanelTabByWindow.set(parsedWindowId, tabId);
        }
      });
    }
  } catch (error) {
    console.error('[FisherAI] Failed to load side panel scope:', error);
  } finally {
    sidePanelScopeLoaded = true;
  }
}

async function persistSidePanelScope() {
  try {
    await chrome.storage.session.set({
      [SIDE_PANEL_SCOPE_STORAGE_KEY]: Object.fromEntries(sidePanelTabByWindow)
    });
  } catch (error) {
    console.error('[FisherAI] Failed to persist side panel scope:', error);
  }
}

async function setGlobalSidePanelDefaults() {
  try {
    await chrome.sidePanel.setOptions({
      path: SIDE_PANEL_PATH,
      enabled: false
    });
  } catch (error) {
    console.error('[FisherAI] Failed to set global side panel defaults:', error);
  }
}

async function setSidePanelOptions(tabId, enabled) {
  if (typeof tabId !== 'number') {
    return;
  }
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: SIDE_PANEL_PATH,
      enabled
    });
  } catch (error) {
    console.error('[FisherAI] Failed to set side panel options:', error);
  }
}

async function applySidePanelScope(windowId) {
  if (typeof windowId !== 'number') {
    return;
  }
  try {
    const scopedTabId = sidePanelTabByWindow.get(windowId);
    const tabs = await chrome.tabs.query({ windowId });
    await Promise.all(
      tabs
        .filter(tab => typeof tab.id === 'number')
        .map(tab => setSidePanelOptions(tab.id, tab.id === scopedTabId))
    );
  } catch (error) {
    console.error('[FisherAI] Failed to apply side panel scope:', error);
  }
}

async function applyAllSidePanelScopes() {
  try {
    const tabs = await chrome.tabs.query({});
    await Promise.all(
      tabs
        .filter(tab => typeof tab.id === 'number' && typeof tab.windowId === 'number')
        .map(tab => setSidePanelOptions(tab.id, tab.id === sidePanelTabByWindow.get(tab.windowId)))
    );
  } catch (error) {
    console.error('[FisherAI] Failed to apply all side panel scopes:', error);
  }
}

async function ensureSidePanelReady() {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (error) {
    console.error('[FisherAI] Failed to set panel behavior:', error);
  }

  await setGlobalSidePanelDefaults();
  await ensureSidePanelScopeLoaded();
  await applyAllSidePanelScopes();
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab || typeof tab.id !== 'number') {
    return;
  }
  if (typeof tab.windowId !== 'number') {
    return;
  }

  await ensureSidePanelScopeLoaded();
  sidePanelTabByWindow.set(tab.windowId, tab.id);
  await persistSidePanelScope();
  await setSidePanelOptions(tab.id, true);
  await applySidePanelScope(tab.windowId);
});

chrome.tabs.onActivated.addListener(async ({ windowId }) => {
  await ensureSidePanelScopeLoaded();
  await applySidePanelScope(windowId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!tab || typeof tab.windowId !== 'number') {
    return;
  }
  await ensureSidePanelScopeLoaded();
  const scopedTabId = sidePanelTabByWindow.get(tab.windowId);
  await setSidePanelOptions(tabId, tabId === scopedTabId);
});

chrome.tabs.onCreated.addListener(async (tab) => {
  if (!tab || typeof tab.id !== 'number' || typeof tab.windowId !== 'number') {
    return;
  }
  await ensureSidePanelScopeLoaded();
  const scopedTabId = sidePanelTabByWindow.get(tab.windowId);
  await setSidePanelOptions(tab.id, tab.id === scopedTabId);
});

chrome.tabs.onRemoved.addListener(async (tabId, removeInfo) => {
  await ensureSidePanelScopeLoaded();
  if (sidePanelTabByWindow.get(removeInfo.windowId) === tabId) {
    sidePanelTabByWindow.delete(removeInfo.windowId);
    await persistSidePanelScope();
    await applySidePanelScope(removeInfo.windowId);
  }
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  await ensureSidePanelScopeLoaded();
  let matchedWindowId = null;
  for (const [windowId, scopedTabId] of sidePanelTabByWindow.entries()) {
    if (scopedTabId === removedTabId) {
      matchedWindowId = windowId;
      break;
    }
  }

  if (matchedWindowId === null) {
    return;
  }

  sidePanelTabByWindow.set(matchedWindowId, addedTabId);
  await persistSidePanelScope();
  await applySidePanelScope(matchedWindowId);
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSidePanelReady();
});

void ensureSidePanelReady();


chrome.runtime.onInstalled.addListener(function() {
  chrome.contextMenus.create({
    id: "mainMenu",
    title: "PagePilot AI",
    contexts: ["all"]
  });
  
  chrome.contextMenus.create({
    id: "downloadSubtitles",
    title: "下载视频字幕文件(SRT)",
    contexts: ["all"],
    parentId: "mainMenu",
    documentUrlPatterns: [
      "*://*.youtube.com/watch*",
      "*://*.bilibili.com/video/*",
      "*://*.bilibili.com/list/watchlater*"
    ]
  });
  chrome.contextMenus.create({
    id: "copyPurePageContent",
    title: "复制网页正文(纯文本)",
    contexts: ["all"],
    parentId: "mainMenu"
  });
  chrome.contextMenus.create({
    id: "copyPageContent",
    title: "复制网页正文(HTML)",
    contexts: ["all"],
    parentId: "mainMenu"
  });
  
});

// 监听菜单项的点击事件
chrome.contextMenus.onClicked.addListener(function(info, tab) {
  if (info.menuItemId === "copyPageContent") {
    chrome.tabs.sendMessage(tab.id, {action: 'copyPageContent'});
  } else if(info.menuItemId === "copyPurePageContent") {
    chrome.tabs.sendMessage(tab.id, {action: 'copyPurePageContent'});
  } else if(info.menuItemId === "downloadSubtitles") {
    chrome.tabs.sendMessage(tab.id, {action: 'downloadSubtitles'});
  }
});
