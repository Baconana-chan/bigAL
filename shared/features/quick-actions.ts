import type {
  ListEntryInfo,
  ListEntryPatch,
  MediaListStatus,
  MediaQuickState,
  StudioMediaNode,
  ViewerInfo,
} from '../api/anilist';
import { deleteListEntry, saveListEntry, scoreScale, scoreToRaw } from '../api/anilist';
import { el, icon, PLAY_ICON } from '../core/dom';
import { formatCountdown } from '../core/time';

const CHECK_ICON = 'M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z';
const CALENDAR_ICON =
  'M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z';
const PENCIL_ICON =
  'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z';
const TRASH_ICON =
  'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';

const STATUS_OPTIONS: Array<{ value: MediaListStatus; label: string }> = [
  { value: 'CURRENT', label: 'Watching' },
  { value: 'PLANNING', label: 'Planning' },
  { value: 'COMPLETED', label: 'Completed' },
  { value: 'REPEATING', label: 'Rewatching' },
  { value: 'PAUSED', label: 'Paused' },
  { value: 'DROPPED', label: 'Dropped' },
];

function statusLabel(status: MediaListStatus): string {
  for (let index = 0; index < STATUS_OPTIONS.length; index += 1) {
    if (STATUS_OPTIONS[index].value === status) {
      return STATUS_OPTIONS[index].label;
    }
  }
  return 'In list';
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong';
}

/* ------------------------------------------------------------------ */
/* Popovers live on <body> so the cover's overflow: hidden cannot clip */
/* them, and are positioned against the button that opened them.       */
/* ------------------------------------------------------------------ */

let activePopover: HTMLElement | null = null;
let activeCleanup: (() => void) | null = null;
let activeAnchor: HTMLElement | null = null;
let announcer: HTMLElement | null = null;

/** Screen-reader announcement that survives the popover being closed. */
function announce(message: string): void {
  if (!announcer || !announcer.isConnected) {
    announcer = el('div', 'alx-sr-only');
    announcer.setAttribute('role', 'status');
    announcer.setAttribute('aria-live', 'polite');
    announcer.setAttribute('aria-atomic', 'true');
    document.body.appendChild(announcer);
  }
  announcer.textContent = message;
}

function focusableIn(root: HTMLElement): HTMLElement[] {
  const nodes = root.querySelectorAll<HTMLElement>(
    'button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
  );
  const result: HTMLElement[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    if (nodes[index].tabIndex >= 0) {
      result.push(nodes[index]);
    }
  }
  return result;
}

export function closeQuickActionsPopover(restoreFocus: boolean = true): void {
  const anchor = activeAnchor;
  if (activeCleanup) {
    activeCleanup();
    activeCleanup = null;
  }
  if (activePopover && activePopover.parentElement) {
    activePopover.parentElement.removeChild(activePopover);
  }
  activePopover = null;
  activeAnchor = null;
  if (anchor) {
    anchor.setAttribute('aria-expanded', 'false');
    if (restoreFocus && anchor.isConnected) {
      anchor.focus();
    }
  }
}

interface PopoverOptions {
  label: string;
  /** Menu popovers get menu roles, roving focus and arrow-key navigation. */
  menu?: boolean;
}

function openPopover(anchor: HTMLElement, content: HTMLElement, options: PopoverOptions): void {
  closeQuickActionsPopover(false);

  const popover = el('div', 'alx-popover');
  popover.setAttribute('role', options.menu ? 'menu' : 'dialog');
  popover.setAttribute('aria-label', options.label);
  popover.tabIndex = -1;
  popover.appendChild(content);
  document.body.appendChild(popover);
  activePopover = popover;
  activeAnchor = anchor;
  anchor.setAttribute('aria-expanded', 'true');

  const rect = anchor.getBoundingClientRect();
  const width = popover.offsetWidth;
  const height = popover.offsetHeight;
  let left = rect.right - width;
  if (left < 8) {
    left = 8;
  }
  if (left + width > window.innerWidth - 8) {
    left = window.innerWidth - width - 8;
  }
  let top = rect.bottom + 6;
  if (top + height > window.innerHeight - 8) {
    top = Math.max(8, rect.top - height - 6);
  }
  popover.style.left = Math.round(left) + 'px';
  popover.style.top = Math.round(top) + 'px';

  const menuItems = (): HTMLButtonElement[] => {
    const nodes = popover.querySelectorAll<HTMLButtonElement>('.alx-menu-item');
    const result: HTMLButtonElement[] = [];
    for (let index = 0; index < nodes.length; index += 1) {
      if (!nodes[index].disabled) {
        result.push(nodes[index]);
      }
    }
    return result;
  };

  const onPopoverKeyDown = (event: KeyboardEvent): void => {
    if (options.menu) {
      if (
        event.key === 'ArrowDown' ||
        event.key === 'ArrowUp' ||
        event.key === 'Home' ||
        event.key === 'End'
      ) {
        const items = menuItems();
        if (items.length > 0) {
          event.preventDefault();
          if (event.key === 'Home') {
            items[0].focus();
          } else if (event.key === 'End') {
            items[items.length - 1].focus();
          } else {
            const current = items.indexOf(document.activeElement as HTMLButtonElement);
            let next = event.key === 'ArrowDown' ? current + 1 : current - 1;
            if (current === -1) {
              next = event.key === 'ArrowDown' ? 0 : items.length - 1;
            }
            if (next < 0) {
              next = items.length - 1;
            }
            if (next >= items.length) {
              next = 0;
            }
            items[next].focus();
          }
        }
        return;
      }
    }

    if (event.key !== 'Tab') {
      return;
    }
    const items = focusableIn(popover);
    if (items.length === 0) {
      event.preventDefault();
      return;
    }
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (current === -1) {
      event.preventDefault();
      (event.shiftKey ? items[items.length - 1] : items[0]).focus();
      return;
    }
    if (!event.shiftKey && current === items.length - 1) {
      event.preventDefault();
      items[0].focus();
    } else if (event.shiftKey && current === 0) {
      event.preventDefault();
      items[items.length - 1].focus();
    }
  };
  popover.addEventListener('keydown', onPopoverKeyDown);

  const onPointerDown = (event: MouseEvent): void => {
    const target = event.target as Node | null;
    if (target && (popover.contains(target) || anchor.contains(target))) {
      return;
    }
    // The click already moved focus where the user wanted it; do not steal it back.
    closeQuickActionsPopover(false);
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeQuickActionsPopover();
    }
  };
  const onViewportChange = (): void => {
    closeQuickActionsPopover(false);
  };

  document.addEventListener('mousedown', onPointerDown, true);
  document.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);

  activeCleanup = () => {
    document.removeEventListener('mousedown', onPointerDown, true);
    document.removeEventListener('keydown', onKeyDown, true);
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('scroll', onViewportChange, true);
    popover.removeEventListener('keydown', onPopoverKeyDown);
  };

  if (options.menu) {
    const items = menuItems();
    const checked = popover.querySelector<HTMLElement>('.alx-menu-item-active');
    (checked || items[0] || popover).focus();
  } else {
    popover.focus();
  }
}

function appendError(container: HTMLElement, message: string): void {
  const existing = container.querySelector('.alx-popover-error');
  if (existing) {
    existing.textContent = message;
  } else {
    container.appendChild(el('div', 'alx-popover-error', message));
  }
  announce(message);
}

function actionButton(path: string, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'alx-action';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.appendChild(icon(path, 'alx-action-icon'));
  return button;
}

function statusButtonLabel(entry: ListEntryInfo | null): string {
  if (!entry) {
    return 'Add to list';
  }
  return 'In list: ' + statusLabel(entry.status);
}

/* --------------------------- status menu --------------------------- */

function openStatusMenu(
  anchor: HTMLElement,
  media: StudioMediaNode,
  context: QuickActionsContext
): void {
  const menu = el('div', 'alx-menu');
  const entry = context.state.entry;
  menu.appendChild(el('div', 'alx-menu-title', 'List status'));

  for (let index = 0; index < STATUS_OPTIONS.length; index += 1) {
    const option = STATUS_OPTIONS[index];
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'alx-menu-item';
    if (entry && entry.status === option.value) {
      item.classList.add('alx-menu-item-active');
    }
    item.textContent = option.label;
    item.setAttribute('role', 'menuitemradio');
    item.setAttribute('aria-checked', entry && entry.status === option.value ? 'true' : 'false');
    item.onclick = () => {
      item.disabled = true;
      saveListEntry(media.id, entry ? entry.id : null, { status: option.value })
        .then((saved) => {
          context.onEntryChanged(saved);
          announce('List status updated');
          closeQuickActionsPopover();
        })
        .catch((error) => {
          item.disabled = false;
          appendError(menu, errorText(error));
        });
    };
    menu.appendChild(item);
  }

  if (entry) {
    menu.appendChild(el('div', 'alx-menu-sep'));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'alx-menu-item alx-menu-item-danger';
    remove.setAttribute('role', 'menuitem');
    remove.appendChild(icon(TRASH_ICON, 'alx-menu-icon'));
    remove.appendChild(document.createTextNode('Remove from list'));
    remove.onclick = () => {
      remove.disabled = true;
      deleteListEntry(entry.id)
        .then(() => {
          context.onEntryChanged(null);
          announce('Removed from your list');
          closeQuickActionsPopover();
        })
        .catch((error) => {
          remove.disabled = false;
          appendError(menu, errorText(error));
        });
    };
    menu.appendChild(remove);
  }

  openPopover(anchor, menu, { label: 'List status', menu: true });
}

/* ----------------------------- editor ----------------------------- */

function field(labelText: string, control: HTMLElement): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = 'alx-field';
  wrap.appendChild(el('span', 'alx-field-label', labelText));
  wrap.appendChild(control);
  return wrap;
}

function selectInput(options: Array<{ value: string; label: string }>, value: string): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'alx-input';
  for (let index = 0; index < options.length; index += 1) {
    const option = document.createElement('option');
    option.value = options[index].value;
    option.textContent = options[index].label;
    select.appendChild(option);
  }
  select.value = value;
  return select;
}

function numberInput(value: string, min: number, max: number, step: number, placeholder: string): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'number';
  input.className = 'alx-input';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = value;
  input.placeholder = placeholder;
  return input;
}

function openEditor(anchor: HTMLElement, media: StudioMediaNode, context: QuickActionsContext): void {
  const viewer = context.viewer;
  if (!viewer) {
    return;
  }
  const entry = context.state.entry;
  const scale = scoreScale(viewer.scoreFormat);

  const form = document.createElement('form');
  form.className = 'alx-form';
  form.appendChild(el('div', 'alx-menu-title', entry ? 'Edit list entry' : 'Add to list'));

  const status = selectInput(
    STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label })),
    entry ? entry.status : 'CURRENT'
  );
  form.appendChild(field('Status', status));

  const score = numberInput(
    entry ? String(entry.score) : '',
    0,
    scale.max,
    scale.step,
    '0 - ' + scale.max
  );
  form.appendChild(field('Score (' + scale.max + '-point scale)', score));

  const progress = numberInput(
    entry ? String(entry.progress) : '0',
    0,
    media.episodes ? media.episodes : 9999,
    1,
    media.episodes ? '0 - ' + media.episodes : '0'
  );
  form.appendChild(field(media.episodes ? 'Episodes (' + media.episodes + ')' : 'Episodes', progress));

  const save = document.createElement('button');
  save.type = 'submit';
  save.className = 'alx-btn alx-form-submit';
  save.textContent = 'Save';
  form.appendChild(save);

  form.onsubmit = (event) => {
    event.preventDefault();
    const scoreText = score.value.trim();
    const progressText = progress.value.trim();
    const patch: ListEntryPatch = { status: status.value as MediaListStatus };

    if (scoreText !== '') {
      const parsed = Number(scoreText);
      if (!isFinite(parsed) || parsed < 0 || parsed > scale.max) {
        appendError(form, 'Score must be between 0 and ' + scale.max);
        return;
      }
      patch.scoreRaw = scoreToRaw(parsed, viewer.scoreFormat);
    }

    const progressValue = progressText === '' ? 0 : Math.floor(Number(progressText));
    if (!isFinite(progressValue) || progressValue < 0) {
      appendError(form, 'Progress must be zero or a positive number');
      return;
    }
    patch.progress = progressValue;

    save.disabled = true;
    saveListEntry(media.id, entry ? entry.id : null, patch)
      .then((saved) => {
        context.onEntryChanged(saved);
        announce('List entry saved');
        closeQuickActionsPopover();
      })
      .catch((error) => {
        save.disabled = false;
        appendError(form, errorText(error));
      });
  };

  openPopover(anchor, form, { label: entry ? 'Edit list entry' : 'Add to list' });
  score.focus();
}

/* ----------------------------- airing ----------------------------- */

function openAiring(anchor: HTMLElement, media: StudioMediaNode, context: QuickActionsContext): void {
  const airing = context.state.nextAiringEpisode;
  const box = el('div', 'alx-airing');
  if (airing) {
    box.appendChild(el('div', 'alx-airing-title', 'Episode ' + airing.episode));
    box.appendChild(el('div', 'alx-airing-time', 'Airs in ' + formatCountdown(airing.airsAt)));
    box.appendChild(el('div', 'alx-airing-date', new Date(airing.airsAt).toLocaleString()));
  } else {
    box.appendChild(el('div', 'alx-airing-title', 'No upcoming episode'));
    const status = media.status === 'FINISHED'
      ? 'This title has finished airing.'
      : media.status === 'NOT_YET_RELEASED'
        ? 'This title has not started airing yet.'
        : 'AniList has no airing schedule for this title.';
    box.appendChild(el('div', 'alx-airing-date', status));
  }
  openPopover(anchor, box, { label: 'Next episode' });
}

/* ----------------------------- actions ----------------------------- */

export interface QuickActionsContext {
  viewer: ViewerInfo | null;
  state: MediaQuickState;
  onEntryChanged: (entry: ListEntryInfo | null) => void;
}

export function buildQuickActions(media: StudioMediaNode, context: QuickActionsContext): HTMLElement {
  const actions = el('div', 'alx-actions');
  const state = context.state;

  const trailer = state.trailer;
  if (trailer && (trailer.site === 'youtube' || trailer.site === 'dailymotion')) {
    const play = actionButton(PLAY_ICON, 'Watch trailer');
    play.onclick = () => {
      const url = trailer.site === 'youtube'
        ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(trailer.id)
        : 'https://www.dailymotion.com/video/' + encodeURIComponent(trailer.id);
      window.open(url, '_blank', 'noopener,noreferrer');
    };
    actions.appendChild(play);
  }

  const entry = state.entry;
  if (context.viewer) {
    const list = actionButton(CHECK_ICON, statusButtonLabel(entry));
    list.setAttribute('aria-haspopup', 'menu');
    list.setAttribute('aria-expanded', 'false');
    if (entry) {
      list.classList.add('alx-action-active');
    }
    list.onclick = () => openStatusMenu(list, media, context);
    actions.appendChild(list);
  }

  if (state.nextAiringEpisode) {
    const calendar = actionButton(CALENDAR_ICON, 'Next episode');
    calendar.setAttribute('aria-haspopup', 'dialog');
    calendar.setAttribute('aria-expanded', 'false');
    calendar.onclick = () => openAiring(calendar, media, context);
    actions.appendChild(calendar);
  }

  if (context.viewer) {
    const edit = actionButton(PENCIL_ICON, entry ? 'Edit list entry' : 'Add with details');
    edit.setAttribute('aria-haspopup', 'dialog');
    edit.setAttribute('aria-expanded', 'false');
    edit.onclick = () => openEditor(edit, media, context);
    actions.appendChild(edit);
  }

  return actions;
}
