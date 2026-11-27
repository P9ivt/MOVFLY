// ==========================================
// GOAB AI - Configuration
// ==========================================
const API_BASE = '/.netlify/functions/chat';
const MODEL = 'gpt-4o-mini';

// ==========================================
// State
// ==========================================
let conversations = JSON.parse(localStorage.getItem('goab_conversations') || '[]');
let currentConversationId = null;
let isGenerating = false;

// ==========================================
// DOM
// ==========================================
const $ = (id) => document.getElementById(id);
const sidebar = $('sidebar');
const chatContainer = $('chatContainer');
const messagesEl = $('messages');
const welcomeEl = $('welcome');
const input = $('userInput');
const sendBtn = $('sendBtn');
const chatHistory = $('chatHistory');
const themeToggle = $('themeToggle');
const newChatBtn = $('newChatBtn');
const openSidebar = $('openSidebar');
const toggleSidebar = $('toggleSidebar');

// ==========================================
// Theme
// ==========================================
const savedTheme = localStorage.getItem('goab_theme') || 'light';
document.documentElement.setAttribute('data-theme', savedTheme);

themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('goab_theme', next);
});

// ==========================================
// Sidebar toggle
// ==========================================
openSidebar.addEventListener('click', () => sidebar.classList.remove('hidden'));
toggleSidebar.addEventListener('click', () => {
  if (window.innerWidth <= 768) {
    sidebar.classList.add('hidden');
  } else {
    sidebar.classList.toggle('hidden');
  }
});

// ==========================================
// Auto-resize textarea
// ==========================================
input.addEventListener('input', () => {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
  sendBtn.disabled = !input.value.trim() || isGenerating;
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    if (!sendBtn.disabled) sendMessage();
  }
});

sendBtn.addEventListener('click', sendMessage);

// ==========================================
// Suggestions
// ==========================================
document.querySelectorAll('.suggestion').forEach(btn => {
  btn.addEventListener('click', () => {
    input.value = btn.dataset.prompt;
    input.dispatchEvent(new Event('input'));
    sendMessage();
  });
});

// ==========================================
// New chat
// ==========================================
newChatBtn.addEventListener('click', () => {
  currentConversationId = null;
  messagesEl.innerHTML = '';
  welcomeEl.style.display = 'flex';
  input.value = '';
  input.dispatchEvent(new Event('input'));
  renderHistory();
});

// ==========================================
// Conversations persistence
// ==========================================
function saveConversations() {
  localStorage.setItem('goab_conversations', JSON.stringify(conversations));
}

function createConversation(title) {
  const conv = {
    id: Date.now().toString(),
    title: title.slice(0, 40),
    messages: [],
    createdAt: new Date().toISOString()
  };
  conversations.unshift(conv);
  saveConversations();
  return conv;
}

function getCurrentConversation() {
  return conversations.find(c => c.id === currentConversationId);
}

function renderHistory() {
  chatHistory.innerHTML = '';
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'history-item' + (conv.id === currentConversationId ? ' active' : '');
    item.textContent = conv.title;
    item.addEventListener('click', () => loadConversation(conv.id));
    chatHistory.appendChild(item);
  });
}

function loadConversation(id) {
  currentConversationId = id;
  const conv = getCurrentConversation();
  messagesEl.innerHTML = '';
  welcomeEl.style.display = 'none';
  conv.messages.forEach(msg => appendMessage(msg.role, msg.content, false));
  renderHistory();
  scrollBottom();
}

// ==========================================
// Render messages
// ==========================================
function formatContent(text) {
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  html = html.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });

  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  return html;
}

function appendMessage(role, content, animate = true) {
  const msg = document.createElement('div');
  msg.className = `message ${role}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = role === 'user' ? 'أ' : 'G';

  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  contentEl.innerHTML = formatContent(content);

  msg.appendChild(avatar);
  msg.appendChild(contentEl);
  messagesEl.appendChild(msg);

  if (animate) scrollBottom();
  return contentEl;
}

function appendTyping() {
  const msg = document.createElement('div');
  msg.className = 'message ai';
  msg.id = 'typingMsg';

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = 'G';

  const contentEl = document.createElement('div');
  contentEl.className = 'message-content';
  contentEl.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';

  msg.appendChild(avatar);
  msg.appendChild(contentEl);
  messagesEl.appendChild(msg);
  scrollBottom();
  return contentEl;
}

function scrollBottom() {
  requestAnimationFrame(() => {
    chatContainer.scrollTop = chatContainer.scrollHeight;
  });
}

// ==========================================
// Send message
// ==========================================
async function sendMessage() {
  const text = input.value.trim();
  if (!text || isGenerating) return;

  isGenerating = true;
  sendBtn.disabled = true;
  welcomeEl.style.display = 'none';

  if (!currentConversationId) {
    const conv = createConversation(text);
    currentConversationId = conv.id;
  }

  const conv = getCurrentConversation();
  conv.messages.push({ role: 'user', content: text });
  saveConversations();
  renderHistory();

  appendMessage('user', text);

  input.value = '';
  input.style.height = 'auto';
  input.dispatchEvent(new Event('input'));

  appendTyping();

  try {
    const response = await fetch(API_BASE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        messages: conv.messages.map(m => ({ role: m.role, content: m.content })),
        stream: true
      })
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`HTTP ${response.status}: ${err}`);
    }

    document.getElementById('typingMsg')?.remove();

    const aiContentEl = appendMessage('ai', '');
    let fullText = '';

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (data === '[DONE]') continue;

        try {
          const json = JSON.parse(data);
          const delta = json.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            aiContentEl.innerHTML = formatContent(fullText);
            scrollBottom();
          }
        } catch (e) { /* ignore */ }
      }
    }

    conv.messages.push({ role: 'assistant', content: fullText });
    saveConversations();
  } catch (err) {
    document.getElementById('typingMsg')?.remove();
    appendMessage('ai', `⚠️ حدث خطأ: ${err.message}\n\nتأكد من:\n1. إضافة GOAB_API_KEY في Netlify\n2. اسم الموديل الصحيح\n3. مراجعة Logs الدالة`);
  } finally {
    isGenerating = false;
    input.dispatchEvent(new Event('input'));
    input.focus();
  }
}

// ==========================================
// Init
// ==========================================
renderHistory();
input.focus();
