import type { AppContext } from '../core/context';
import { ACCENT_NAMES, accentLabel } from '../core/palette';
import { el, icon } from '../core/dom';
import { openCalendar, openTriage } from '../core/router';
import { MAX_FRIENDS, parseFriendInput } from '../core/settings';

const GEAR_ICON =
  'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z';

interface CheckboxRow {
  row: HTMLLabelElement;
  input: HTMLInputElement;
}

function checkboxRow(title: string, checked: boolean, onChange: (value: boolean) => void): CheckboxRow {
  const row = document.createElement('label');
  row.className = 'alx-check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  input.onchange = () => onChange(input.checked);
  const text = el('span', 'alx-check-text', title);
  row.appendChild(input);
  row.appendChild(text);
  return { row, input };
}

function hint(text: string): HTMLElement {
  return el('div', 'alx-hint', text);
}

function section(title: string): HTMLElement {
  const wrap = el('div', 'alx-section');
  wrap.appendChild(el('div', 'alx-section-title', title));
  return wrap;
}

export function createPanel(ctx: AppContext): void {
  const fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'alx-fab';
  fab.title = 'bigAL settings';
  fab.setAttribute('aria-label', 'bigAL settings');
  fab.appendChild(icon(GEAR_ICON));
  document.body.appendChild(fab);

  const open = (): void => {
    const settings = ctx.settings.get();
    const overlay = el('div', 'alx-overlay');

    const dialog = el('div', 'alx-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'bigAL settings');

    const head = el('div', 'alx-dialog-head');
    const titleWrap = el('div', 'alx-dialog-title-wrap');
    titleWrap.appendChild(el('div', 'alx-dialog-title', 'bigAL'));
    titleWrap.appendChild(el('div', 'alx-dialog-version', 'v' + ctx.version));
    head.appendChild(titleWrap);
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'alx-close';
    close.setAttribute('aria-label', 'Close settings');
    close.textContent = '\u00d7';
    head.appendChild(close);
    dialog.appendChild(head);

    const pages = section('Pages');
    const quickRow = checkboxRow('Quick list actions on studio covers', settings.quickActions, (value) => {
      void ctx.settings.update({ quickActions: value });
    });
    const dnaRow = checkboxRow('Studio DNA on studio pages', settings.studioDna, (value) => {
      void ctx.settings.update({ studioDna: value });
    });
    const studioRow = checkboxRow('Enhanced studio pages', settings.studios, (value) => {
      quickRow.input.disabled = !value;
      dnaRow.input.disabled = !value;
      void ctx.settings.update({ studios: value });
    });
    pages.appendChild(studioRow.row);
    pages.appendChild(hint('Full work paging, filters and studio stats instead of the newest 25 titles.'));
    quickRow.row.className = 'alx-check alx-check-nested';
    quickRow.input.disabled = !settings.studios;
    pages.appendChild(quickRow.row);
    pages.appendChild(
      hint('Trailer, status, score and progress controls when hovering a cover. List markers stay either way.')
    );

    dnaRow.row.className = 'alx-check alx-check-nested';
    dnaRow.input.disabled = !settings.studios;
    pages.appendChild(dnaRow.row);
    pages.appendChild(
      hint('Directors, composers and cast who keep coming back across the studio\u2019s most popular works, with links to their pages.')
    );

    const themesRow = checkboxRow('Openings & endings on title pages', settings.themes, (value) => {
      spoilerRow.input.disabled = !value;
      void ctx.settings.update({ themes: value });
    });
    pages.appendChild(themesRow.row);
    const spoilerRow = checkboxRow('Reveal spoiler themes automatically', settings.showSpoilers, (value) => {
      void ctx.settings.update({ showSpoilers: value });
    });
    spoilerRow.row.className = 'alx-check alx-check-nested';
    spoilerRow.input.disabled = !settings.themes;
    pages.appendChild(spoilerRow.row);
    pages.appendChild(hint('Themes come from AnimeThemes; NSFW entries still need a click.'));

    const studiosSummaryRow = checkboxRow('Studio credits on title pages', settings.studioSummary, (value) => {
      void ctx.settings.update({ studioSummary: value });
    });
    pages.appendChild(studiosSummaryRow.row);
    pages.appendChild(
      hint('The title\u2019s animation studios, main credits first, with a few key works and a link to the studio page.')
    );

    const franchiseRow = checkboxRow('Franchise tracker on title pages', settings.franchiseTracker, (value) => {
      void ctx.settings.update({ franchiseTracker: value });
    });
    pages.appendChild(franchiseRow.row);
    pages.appendChild(
      hint(
        'The franchise around a title in release order, your progress on each entry and the next unwatched episode, with a full tracker view.'
      )
    );

    const friendsRow = checkboxRow("Friends' progress on title pages", settings.friendsProgress, (value) => {
      friendsInput.disabled = !value;
      void ctx.settings.update({ friendsProgress: value });
    });
    pages.appendChild(friendsRow.row);
    const friendsControls = el('div', 'alx-controls');
    const friendsInput = document.createElement('input');
    friendsInput.type = 'text';
    friendsInput.className = 'alx-input';
    friendsInput.placeholder = 'AniList usernames, comma separated';
    friendsInput.setAttribute('aria-label', 'Friends to compare progress with');
    friendsInput.value = settings.friends.join(', ');
    friendsInput.disabled = !settings.friendsProgress;
    const applyFriends = (): void => {
      const names = parseFriendInput(friendsInput.value);
      friendsInput.value = names.join(', ');
      if (names.join(',') !== ctx.settings.get().friends.join(',')) {
        void ctx.settings.update({ friends: names });
      }
    };
    friendsInput.onchange = applyFriends;
    // Enter commits the field, and closing the dialog commits it too: typing
    // names and pressing Escape should not throw the edit away.
    friendsInput.onkeydown = (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        friendsInput.blur();
      }
    };
    friendsControls.appendChild(friendsInput);
    pages.appendChild(friendsControls);
    pages.appendChild(
      hint(
        'Up to ' +
          MAX_FRIENDS +
          ' public profiles. Your own episodes come from your AniList session; only counts, status and deltas are shown.'
      )
    );

    const plansRow = checkboxRow('Anime in Plans on the home page', settings.homePlans, (value) => {
      void ctx.settings.update({ homePlans: value });
    });
    pages.appendChild(plansRow.row);
    pages.appendChild(hint('Planned titles whose first episode has not aired yet, with a live countdown.'));

    const continueRow = checkboxRow('Continue watching on the home page', settings.continueWatching, (value) => {
      void ctx.settings.update({ continueWatching: value });
    });
    pages.appendChild(continueRow.row);
    pages.appendChild(
      hint('The next unwatched episode of every current title, with how many episodes are already out or when the next one airs.')
    );

    const picksRow = checkboxRow('Next from your plans on the home page', settings.backlogPicks, (value) => {
      void ctx.settings.update({ backlogPicks: value });
    });
    pages.appendChild(picksRow.row);
    pages.appendChild(
      hint('Planning entries AniList links to titles you rated highly, with the title that suggests them.')
    );
    dialog.appendChild(pages);

    const accent = section('Profile accent');
    const accentRow = checkboxRow('Apply profile color to the whole site', settings.profileColor, (value) => {
      sourceSelect.disabled = !value;
      usernameInput.disabled = !value;
      void ctx.settings.update({ profileColor: value });
    });
    accent.appendChild(accentRow.row);

    const controls = el('div', 'alx-controls');
    const sourceSelect = document.createElement('select');
    sourceSelect.className = 'alx-input';
    const autoOption = document.createElement('option');
    autoOption.value = 'auto';
    autoOption.textContent = 'Auto (from profile)';
    sourceSelect.appendChild(autoOption);
    for (let index = 0; index < ACCENT_NAMES.length; index += 1) {
      const name = ACCENT_NAMES[index];
      const option = document.createElement('option');
      option.value = name;
      option.textContent = accentLabel(name);
      sourceSelect.appendChild(option);
    }
    sourceSelect.value = settings.profileColorSource;
    sourceSelect.disabled = !settings.profileColor;
    controls.appendChild(sourceSelect);

    const usernameInput = document.createElement('input');
    usernameInput.type = 'text';
    usernameInput.className = 'alx-input';
    usernameInput.placeholder = 'AniList username';
    usernameInput.value = settings.profileUsername;
    usernameInput.disabled = !settings.profileColor || settings.profileColorSource !== 'auto';
    usernameInput.onchange = () => {
      void ctx.settings.update({ profileUsername: usernameInput.value.trim() });
    };
    controls.appendChild(usernameInput);
    accent.appendChild(controls);

    const syncUsernameState = (): void => {
      const auto = sourceSelect.value === 'auto';
      usernameInput.style.display = auto ? '' : 'none';
      usernameInput.disabled = !ctx.settings.get().profileColor || !auto;
    };
    sourceSelect.onchange = () => {
      syncUsernameState();
      void ctx.settings.update({
        profileColorSource: sourceSelect.value === 'auto' ? 'auto' : (sourceSelect.value as typeof settings.profileColorSource),
      });
    };
    syncUsernameState();
    accent.appendChild(hint('Leave the username empty to detect it from your profile; set it if auto-detection misses.'));
    dialog.appendChild(accent);

    const calendar = section('Calendar');
    calendar.appendChild(el('div', 'alx-hint alx-hint-flush', 'Month view of your watching schedule and planned premieres, exportable as .ics. Opens as its own view, so the home page stays as it is.'));
    const calendarButton = document.createElement('button');
    calendarButton.type = 'button';
    calendarButton.className = 'alx-btn alx-btn-small';
    calendarButton.textContent = 'Open premiere calendar';
    calendarButton.onclick = () => {
      closePanel();
      openCalendar();
    };
    calendar.appendChild(calendarButton);
    dialog.appendChild(calendar);

    const triage = section('Backlog');
    triage.appendChild(
      el(
        'div',
        'alx-hint alx-hint-flush',
        'Review planning entries untouched for years, several seasons of one franchise, or sequels whose first season you dropped. Nothing changes until you pick a bulk action.'
      )
    );
    const triageButton = document.createElement('button');
    triageButton.type = 'button';
    triageButton.className = 'alx-btn alx-btn-small alx-btn-ghost';
    triageButton.textContent = 'Review planning backlog';
    triageButton.onclick = () => {
      closePanel();
      openTriage();
    };
    triage.appendChild(triageButton);
    dialog.appendChild(triage);

    const status = el('div', 'alx-status');
    dialog.appendChild(status);

    const unsubscribe = ctx.status.subscribe((text) => {
      status.textContent = text;
      status.style.display = text ? '' : 'none';
    });

    const closePanel = (): void => {
      applyFriends();
      unsubscribe();
      window.removeEventListener('keydown', onKey);
      if (overlay.parentElement) {
        overlay.parentElement.removeChild(overlay);
      }
    };

    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        closePanel();
      }
    };

    close.onclick = closePanel;
    overlay.onclick = (event) => {
      if (event.target === overlay) {
        closePanel();
      }
    };
    window.addEventListener('keydown', onKey);

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
    close.focus();
  };

  fab.onclick = open;
}
