import { api, ApiError } from '../shared/api.js';
import {
  login,
  register,
  logout,
  getSessionUser,
  updateProfile,
  changePassword,
  deleteAccount,
} from '../shared/auth.js';
import { getTheme, setTheme } from '../shared/storage.js';
import { getApiBaseUrl } from '../shared/config.js';
import { normalizeUrl } from '../shared/url.js';

const $ = (sel) => document.querySelector(sel);

const views = {
  loading: $('#view-loading'),
  auth: $('#view-auth'),
  main: $('#view-main'),
  collection: $('#view-collection'),
  settings: $('#view-settings'),
};

const statusEl = $('#status');
const authForm = $('#auth-form');
const registerFields = $('#register-fields');
const authTitle = $('#auth-title');
const authSubmit = $('#auth-submit');
const toggleAuthMode = $('#toggle-auth-mode');
const bookmarkList = $('#bookmark-list');
const emptyState = $('#empty-state');
const collectionList = $('#collection-list');
const collectionsEmpty = $('#collections-empty');
const addForm = $('#add-form');
const userLine = $('#user-line');
const bookmarkFields = $('#bookmark-fields');
const collectionFields = $('#collection-fields');
const bookmarkCollectionSelect = $('#bookmark-collection');
const collectionBookmarksEl = $('#collection-bookmarks');
const collectionEmpty = $('#collection-empty');
const collectionAddForm = $('#collection-add-form');
const addSubmit = $('#add-submit');
const collectionAddSubmit = $('#collection-add-submit');
const libraryEmpty = $('#library-empty');
const libraryContent = $('#library-content');
const profileForm = $('#profile-form');
const passwordForm = $('#password-form');
const deleteForm = $('#delete-form');

let authMode = 'login';
let composerType = 'bookmark';
let currentUser = null;
let collectionsCache = [];
let activeCollectionId = null;
let editingBookmarkId = null;
const bookmarkCache = new Map();

function showView(name) {
  Object.entries(views).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
}

function showStatus(message, type = 'error') {
  statusEl.hidden = false;
  statusEl.textContent = message;
  statusEl.className = `status ${type}`;
}

function clearStatus() {
  statusEl.hidden = true;
  statusEl.textContent = '';
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hostnameFromUrl(url) {
  try {
    return new URL(normalizeUrl(url)).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function collectionName(bookmark) {
  if (!bookmark.collection) return '';
  if (typeof bookmark.collection === 'object') {
    return bookmark.collection.name || '';
  }
  const found = collectionsCache.find((item) => item._id === bookmark.collection);
  return found ? found.name : '';
}

function cacheBookmarks(bookmarks) {
  bookmarks.forEach((bookmark) => {
    bookmarkCache.set(String(bookmark._id), bookmark);
  });
}

function tagsToInput(bookmark) {
  return Array.isArray(bookmark.tags) ? bookmark.tags.filter(Boolean).join(', ') : '';
}

function collectionIdOf(bookmark) {
  if (!bookmark.collection) return '';
  if (typeof bookmark.collection === 'object') {
    return bookmark.collection._id || '';
  }
  return bookmark.collection;
}

function fillBookmarkForm(form, bookmark) {
  form.elements.title.value = bookmark.title || '';
  form.elements.url.value = bookmark.url || '';
  form.elements.category.value = bookmark.category || '';
  form.elements.tags.value = tagsToInput(bookmark);
  if (form.elements.collectionId) {
    fillCollectionSelect(collectionIdOf(bookmark));
  }
}

function bookmarkPayload(form, collectionId) {
  const data = new FormData(form);
  const title = String(data.get('title') || '').trim();
  const url = String(data.get('url') || '').trim();
  return {
    title,
    url: url ? normalizeUrl(url) : '',
    category: data.get('category'),
    tags: data.get('tags'),
    notes: '',
    collectionId: collectionId === undefined
      ? (data.get('collectionId') || '')
      : collectionId,
  };
}

function bookmarkRowHtml(bookmark) {
  const href = escapeHtml(normalizeUrl(bookmark.url));
  const title = escapeHtml(bookmark.title);
  const host = escapeHtml(hostnameFromUrl(bookmark.url));
  const category = bookmark.category ? escapeHtml(bookmark.category) : '';
  const tags = Array.isArray(bookmark.tags) ? bookmark.tags.filter(Boolean) : [];
  const collection = escapeHtml(collectionName(bookmark));

  const chips = [
    category ? `<span class="chip">${category}</span>` : '',
    collection ? `<span class="chip chip-quiet">${collection}</span>` : '',
    ...tags.map((tag) => `<span class="chip chip-quiet">${escapeHtml(tag)}</span>`),
  ].join('');

  return `
    <a class="bookmark-main" href="${href}" target="_blank" rel="noopener noreferrer">
      <span class="bookmark-title">${title}</span>
      <span class="bookmark-host">${host}</span>
      ${chips ? `<div class="bookmark-meta">${chips}</div>` : ''}
    </a>
    <div class="item-actions">
      <button class="text-btn" type="button" data-edit="${bookmark._id}" aria-label="Edit ${title}">Edit</button>
      <button class="icon-btn icon-btn-danger" type="button" data-delete="${bookmark._id}" aria-label="Delete ${title}" title="Delete">×</button>
    </div>
  `;
}

function renderBookmarkList(container, bookmarks, emptyEl) {
  container.textContent = '';
  emptyEl.hidden = bookmarks.length > 0;

  bookmarks.forEach((bookmark) => {
    const item = document.createElement('article');
    item.className = 'bookmark-row';
    item.innerHTML = bookmarkRowHtml(bookmark);
    container.appendChild(item);
  });
}

function renderCollections(collections) {
  collectionList.textContent = '';
  collectionsEmpty.hidden = collections.length > 0;

  collections.forEach((collection) => {
    const count = Array.isArray(collection.bookmarks) ? collection.bookmarks.length : 0;
    const item = document.createElement('article');
    item.className = 'collection-card';
    item.innerHTML = `
      <button type="button" class="collection-main" data-open-collection="${collection._id}">
        <span class="collection-name">${escapeHtml(collection.name)}</span>
        <span class="collection-meta">${count} bookmark${count === 1 ? '' : 's'}</span>
        ${collection.description ? `<span class="collection-desc">${escapeHtml(collection.description)}</span>` : ''}
      </button>
      <button class="icon-btn icon-btn-danger" type="button" data-delete-collection="${collection._id}" aria-label="Delete ${escapeHtml(collection.name)}" title="Delete">×</button>
    `;
    collectionList.appendChild(item);
  });
}

function fillCollectionSelect(selectedId = '') {
  const current = selectedId || bookmarkCollectionSelect.value;
  bookmarkCollectionSelect.innerHTML = '<option value="">None</option>';
  collectionsCache.forEach((collection) => {
    const option = document.createElement('option');
    option.value = collection._id;
    option.textContent = collection.name;
    bookmarkCollectionSelect.appendChild(option);
  });
  bookmarkCollectionSelect.value = current;
}

async function loadLibrary() {
  const [{ bookmarks }, { collections }] = await Promise.all([
    api.listBookmarks(),
    api.listCollections(),
  ]);
  collectionsCache = collections;
  cacheBookmarks(bookmarks);
  const bothEmpty = bookmarks.length === 0 && collections.length === 0;
  libraryEmpty.hidden = !bothEmpty;
  libraryContent.hidden = bothEmpty;
  renderCollections(collections);
  renderBookmarkList(bookmarkList, bookmarks, emptyState);
  fillCollectionSelect();
}

function openComposer(type = 'bookmark') {
  hideCollectionComposer();
  editingBookmarkId = null;
  addSubmit.textContent = 'Save';
  setComposerTabsHidden(false);
  addForm.hidden = false;
  setComposerType(type);
  fillCollectionSelect();
  addForm.scrollIntoView({ block: 'nearest' });
  const focusEl = type === 'collection' ? addForm.elements.name : addForm.elements.title;
  fo