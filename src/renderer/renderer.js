const MAX_RENDERED = 2000;

const queryInput = document.getElementById('query');
const searchBtn = document.getElementById('search-btn');
const cancelBtn = document.getElementById('cancel-btn');
const categoriesEl = document.getElementById('categories');
const datePreset = document.getElementById('date-preset');
const customDates = document.getElementById('custom-dates');
const dateFrom = document.getElementById('date-from');
const dateTo = document.getElementById('date-to');
const folderBtn = document.getElementById('folder-btn');
const folderLabel = document.getElementById('folder-label');
const includeHidden = document.getElementById('include-hidden');
const themeSelect = document.getElementById('theme');
const languageSelect = document.getElementById('language');
const settingsBtn = document.getElementById('settings-btn');
const settingsModal = document.getElementById('settings-modal');
const settingsClose = document.getElementById('settings-close');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');

const ICONS = {
  image: '🖼️',
  video: '🎬',
  document: '📄',
  audio: '🎵',
  archive: '🗜️',
  folder: '📁',
  other: '📦',
};
const EXT_CATEGORY = {};
for (const [cat, exts] of Object.entries({
  video: ['mp4', 'mkv', 'avi', 'mov', 'wmv', 'flv', 'webm', 'm4v', 'mpg', 'mpeg', '3gp', 'ts', 'vob'],
  image: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'svg', 'heic', 'heif', 'raw', 'cr2', 'nef', 'arw', 'ico'],
  document: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'rtf', 'odt', 'ods', 'odp', 'csv', 'md', 'epub'],
  audio: ['mp3', 'wav', 'flac', 'm4a', 'aac', 'ogg', 'wma', 'opus', 'mid', 'midi'],
  archive: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'],
})) {
  for (const ext of exts) EXT_CATEGORY[ext] = cat;
}

// Loads thumbnails only when a row scrolls into view, so huge result lists stay cheap.
const thumbnailObserver = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    thumbnailObserver.unobserve(entry.target);
    loadThumbnail(entry.target);
  }
}, { rootMargin: '200px' });

let language = detectLanguage();
let searchFolder = '';
let searching = false;
let renderedCount = 0;
let matchCount = 0;

init();

async function init() {
  languageSelect.value = language;
  applyTranslations();
  languageSelect.addEventListener('change', () => {
    language = languageSelect.value;
    localStorage.setItem('language', language);
    applyTranslations();
  });

  settingsBtn.addEventListener('click', () => settingsModal.showModal());
  settingsClose.addEventListener('click', () => settingsModal.close());
  settingsModal.addEventListener('click', (e) => {
    if (e.target === settingsModal) settingsModal.close();
  });

  const savedTheme = localStorage.getItem('theme') || 'system';
  themeSelect.value = savedTheme;
  window.api.setTheme(savedTheme);
  themeSelect.addEventListener('change', () => {
    localStorage.setItem('theme', themeSelect.value);
    window.api.setTheme(themeSelect.value);
  });

  searchFolder = await window.api.getDefaultFolder();
  folderLabel.textContent = searchFolder;

  searchBtn.addEventListener('click', startSearch);
  queryInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') startSearch();
  });
  cancelBtn.addEventListener('click', () => {
    window.api.cancelSearch();
    finishSearch(t(matchCount === 1 ? 'stoppedOne' : 'stoppedMany', { count: matchCount }));
  });

  categoriesEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    categoriesEl.querySelectorAll('.chip').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
  });

  datePreset.addEventListener('change', () => {
    customDates.hidden = datePreset.value !== 'custom';
  });

  folderBtn.addEventListener('click', async () => {
    const picked = await window.api.pickFolder(searchFolder, t('pickFolderTitle'));
    if (!picked) return;
    searchFolder = picked;
    folderLabel.textContent = picked;
  });

  window.api.onResults(renderBatch);
  window.api.onDone(onDone);
  window.api.onError((message) => {
    finishSearch(message, true);
  });
}

function t(key, vars) {
  let text = STRINGS[language][key] ?? STRINGS['en-US'][key] ?? key;
  for (const [name, value] of Object.entries(vars || {})) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}

function applyTranslations() {
  document.title = t('appTitle');
  for (const el of document.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
  for (const el of document.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  if (!searching) setStatus(t('initialHint'));
}

function startSearch() {
  if (searching) window.api.cancelSearch();

  thumbnailObserver.disconnect();
  resultsEl.replaceChildren();
  renderedCount = 0;
  matchCount = 0;
  searching = true;
  searchBtn.hidden = true;
  cancelBtn.hidden = false;
  setStatus(t('searching'));

  window.api.startSearch({
    root: searchFolder,
    query: queryInput.value.trim(),
    category: categoriesEl.querySelector('.chip.active').dataset.category,
    includeHidden: includeHidden.checked,
    ...dateRange(),
  });
}

function dateRange() {
  const preset = datePreset.value;
  if (preset === 'any') return {};
  if (preset === 'custom') {
    return {
      modifiedAfter: dateFrom.value || undefined,
      modifiedBefore: dateTo.value || undefined,
    };
  }
  const from = new Date();
  from.setDate(from.getDate() - Number(preset));
  return { modifiedAfter: from.toISOString().slice(0, 10) };
}

function renderBatch(batch) {
  matchCount += batch.length;
  if (searching) setStatus(t('searchingCount', { count: matchCount }));

  const room = MAX_RENDERED - renderedCount;
  if (room <= 0) return;

  const fragment = document.createDocumentFragment();
  for (const file of batch.slice(0, room)) {
    fragment.appendChild(resultRow(file));
    renderedCount++;
  }
  resultsEl.appendChild(fragment);
}

function resultRow(file) {
  const row = document.createElement('div');
  row.className = 'result';

  const category = EXT_CATEGORY[file.ext];
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.textContent = file.is_dir ? ICONS.folder : (ICONS[category] || ICONS.other);
  if (!file.is_dir && (category === 'image' || category === 'video')) {
    icon.dataset.path = file.path;
    thumbnailObserver.observe(icon);
  }

  const info = document.createElement('div');
  info.className = 'info';
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = file.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [
    parentFolder(file.path),
    file.is_dir ? t('folderMeta') : formatSize(file.size),
    file.modified ? new Date(file.modified).toLocaleDateString(language) : '',
  ].filter(Boolean).join('  ·  ');
  info.append(name, meta);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const showBtn = document.createElement('button');
  showBtn.textContent = t('showInFolder');
  showBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    window.api.showInFolder(file.path);
  });
  actions.appendChild(showBtn);

  row.append(icon, info, actions);
  row.title = file.path;
  row.addEventListener('dblclick', () => window.api.openFile(file.path));
  return row;
}

async function loadThumbnail(iconEl) {
  const dataUrl = await window.api.getThumbnail(iconEl.dataset.path).catch(() => null);
  if (!dataUrl || !iconEl.isConnected) return;
  const img = document.createElement('img');
  img.className = 'thumb';
  img.src = dataUrl;
  img.alt = '';
  iconEl.replaceWith(img);
}

function onDone(stats) {
  let message;
  if (stats.matched === 0) {
    message = t('nothingFound');
  } else {
    message = t(stats.matched === 1 ? 'foundOne' : 'foundMany', { count: stats.matched });
    if (stats.truncated) message += t('truncatedNote');
    else if (stats.matched > MAX_RENDERED) message += t('showingFirst', { count: MAX_RENDERED });
    message += t('doubleClickHint');
  }
  finishSearch(message);
}

function finishSearch(message, isError = false) {
  searching = false;
  searchBtn.hidden = false;
  cancelBtn.hidden = true;
  setStatus(message, isError);
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

function parentFolder(fullPath) {
  const i = fullPath.lastIndexOf('\\');
  return i > 0 ? fullPath.slice(0, i) : fullPath;
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit++;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}
