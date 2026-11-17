const language = new URLSearchParams(location.search).get('lang')
const zh = language ? language === 'zh' : navigator.languages.some(l => l.startsWith('zh'))
export const s = zh ? {
  files: '画布', readOnly: '只读预览', search: '查找画布…', hide: '收起文件列表', show: '显示文件列表',
  select: '选择卡片，描述想怎么改', placeholder: '希望 AI 怎样修改这些卡片？', empty: '先选择一张或多张卡片…',
  send: '发送到当前聊天', sending: '正在发送…', sent: '已发送到当前聊天，等待 AI 处理', remove: '移除引用', clear: '清除选择',
  disconnected: '当前为浏览器预览，尚未连接聊天。请从 MCP App 面板打开以发送。', connected: '已连接当前聊天',
  enter: 'Enter 发送 · Shift + Enter 换行', help: '点击选择 · Shift 多选 / 框选 · 拖动空白处平移 · ⌘ / Ctrl + 滚轮缩放',
  fit: '查看全部', focus: '聚焦所选', zoomIn: '放大', zoomOut: '缩小', normal: '原始比例',
  loading: '正在读取画布…', noBoards: '这个文件夹中没有 Canvas 文件', needsVault: '请先在聊天中告诉 AI 要打开哪个 Obsidian Vault 文件夹。',
  noResults: '没有匹配的画布', retry: '重试', error: '读取失败', refresh: '刷新', synced: '已同步', waiting: '正在连接…',
  missing: '无法预览这个文件', note: '关联笔记', unsupported: '此类型暂不支持预览', draft: '修改指令',
} : {
  files: 'Canvases', readOnly: 'Read-only preview', search: 'Find a canvas…', hide: 'Hide file list', show: 'Show file list',
  select: 'Select cards. Describe a change.', placeholder: 'What would you like AI to change?', empty: 'Select one or more cards first…',
  send: 'Send to current chat', sending: 'Sending…', sent: 'Sent to current chat. Waiting for AI.', remove: 'Remove reference', clear: 'Clear selection',
  disconnected: 'Browser preview is not connected to chat. Open the MCP App panel to send.', connected: 'Connected to this chat',
  enter: 'Enter to send · Shift + Enter for a new line', help: 'Click to select · Shift to add / box-select · Drag background to pan · ⌘ / Ctrl + wheel to zoom',
  fit: 'Fit all', focus: 'Focus selection', zoomIn: 'Zoom in', zoomOut: 'Zoom out', normal: 'Actual size',
  loading: 'Reading canvas…', noBoards: 'No Canvas files in this folder', needsVault: 'Tell AI in chat which Obsidian vault folder to open first.',
  noResults: 'No matching canvases', retry: 'Retry', error: 'Could not load', refresh: 'Refresh', synced: 'Synced', waiting: 'Connecting…',
  missing: 'Cannot preview this file', note: 'Linked note', unsupported: 'Preview unavailable for this file type', draft: 'Change request',
}
