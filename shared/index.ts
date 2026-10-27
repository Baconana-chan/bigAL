import contentCss from './styles/content.css';
import type { AppContext } from './core/context';
import { StatusBus } from './core/context';
import type { Platform } from './core/platform';
import type { Route } from './core/router';
import { startHashRouter, startRouter } from './core/router';
import { mountCalendar } from './features/calendar';
import { mountContinueWatching } from './features/continue-watching';
import { mountFranchise, mountFranchiseSummary } from './features/franchise';
import { mountTriage } from './features/triage';
import { SettingsStore } from './core/settings';
import { mountBacklogPicks } from './features/backlog-picks';
import { mountHomePlans } from './features/home-plans';
import { mountFriends } from './features/friends';
import { mountProfileColor } from './features/profile-color';
import { mountStudio } from './features/studio';
import { mountStudioSummary } from './features/studio-summary';
import { mountThemes } from './features/themes';
import { createPanel } from './ui/panel';

export function boot(platform: Platform): void {
  platform.addStyle(contentCss);

  const settings = new SettingsStore(platform);
  const status = new StatusBus();
  let currentRoute: Route = { kind: 'other' };
  let featureCleanups: Array<() => void> = [];
  let profileCleanup: (() => void) | null = null;
  let overlayCleanup: (() => void) | null = null;
  let ready = false;

  const ctx: AppContext = {
    platform,
    settings,
    status,
    version: __VERSION__,
    rerender() {
      if (ready) {
        applyRoute(currentRoute);
      }
    },
  };

  function applyRoute(route: Route): void {
    for (let index = 0; index < featureCleanups.length; index += 1) {
      featureCleanups[index]();
    }
    featureCleanups = [];

    const current = settings.get();

    if (route.kind === 'studio' && current.studios) {
      featureCleanups.push(
        mountStudio(route.id, { quickActions: current.quickActions, dna: current.studioDna })
      );
    }
    if (route.kind === 'anime' && current.themes) {
      featureCleanups.push(mountThemes(ctx, route.id));
    }
    if (route.kind === 'anime' && current.studioSummary) {
      featureCleanups.push(mountStudioSummary(route.id));
    }
    if (route.kind === 'anime' && current.franchiseTracker) {
      featureCleanups.push(mountFranchiseSummary(route.id));
    }
    if (route.kind === 'anime' && current.friendsProgress && current.friends.length > 0) {
      featureCleanups.push(mountFriends(ctx, route.id));
    }
    if (route.kind === 'home' && current.homePlans) {
      featureCleanups.push(mountHomePlans());
    }
    if (route.kind === 'home' && current.continueWatching) {
      featureCleanups.push(mountContinueWatching());
    }
    if (route.kind === 'home' && current.backlogPicks) {
      featureCleanups.push(mountBacklogPicks());
    }

    if (!current.profileColor) {
      if (profileCleanup) {
        profileCleanup();
        profileCleanup = null;
      }
      status.set('');
    } else if (!profileCleanup) {
      profileCleanup = mountProfileColor(ctx);
    }
  }

  const start = async (): Promise<void> => {
    await settings.load();
    ready = true;

    createPanel(ctx);

    settings.subscribe(() => {
      if (!ready) {
        return;
      }
      // The accent depends on the settings, so force a fresh mount; page
      // features can just be re-applied to the current route.
      if (profileCleanup) {
        profileCleanup();
        profileCleanup = null;
      }
      applyRoute(currentRoute);
    });

    startRouter((route) => {
      currentRoute = route;
      applyRoute(route);
    });

    // The calendar, triage and franchise tracker live on hash routes, so they
    // open over any page, survive reloads and close with the back button.
    startHashRouter((view) => {
      if (overlayCleanup) {
        overlayCleanup();
        overlayCleanup = null;
      }
      if (!view) {
        return;
      }
      if (view.kind === 'calendar') {
        overlayCleanup = mountCalendar(view.month);
      } else if (view.kind === 'franchise') {
        overlayCleanup = mountFranchise(view.id);
      } else {
        overlayCleanup = mountTriage();
      }
    });
  };

  void start();
}
