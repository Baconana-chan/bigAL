import type { Platform } from './platform';
import type { SettingsStore } from './settings';

type StatusListener = (text: string) => void;

export class StatusBus {
  private text = '';
  private listeners: StatusListener[] = [];

  set(text: string): void {
    if (this.text === text) {
      return;
    }
    this.text = text;
    const snapshot = this.listeners.slice();
    for (let index = 0; index < snapshot.length; index += 1) {
      snapshot[index](text);
    }
  }

  get(): string {
    return this.text;
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.push(listener);
    listener(this.text);
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index !== -1) {
        this.listeners.splice(index, 1);
      }
    };
  }
}

export interface AppContext {
  platform: Platform;
  settings: SettingsStore;
  status: StatusBus;
  version: string;
  rerender(): void;
}
