export function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function linkEl(href: string, className: string, text?: string): HTMLAnchorElement {
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.className = className;
  if (text !== undefined) {
    anchor.textContent = text;
  }
  return anchor;
}

export function icon(pathData: string, className?: string): SVGSVGElement {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  if (className) {
    svg.setAttribute('class', className);
  }
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', pathData);
  path.setAttribute('fill', 'currentColor');
  svg.appendChild(path);
  return svg;
}

export const PLAY_ICON = 'M8 5v14l11-7z';
export const HEART_ICON =
  'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

export function waitFor(selector: string, timeoutMs = 15000): Promise<Element | null> {
  const existing = document.querySelector(selector);
  if (existing) {
    return Promise.resolve(existing);
  }

  return new Promise((resolve) => {
    let finished = false;
    let observer: MutationObserver | null = null;
    let poll = 0;
    let timer = 0;

    const finish = (value: Element | null): void => {
      if (finished) {
        return;
      }
      finished = true;
      if (observer) {
        observer.disconnect();
      }
      window.clearInterval(poll);
      window.clearTimeout(timer);
      resolve(value);
    };

    const check = (): void => {
      const node = document.querySelector(selector);
      if (node) {
        finish(node);
      }
    };

    observer = new MutationObserver(check);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    poll = window.setInterval(check, 500);
    timer = window.setTimeout(() => finish(document.querySelector(selector)), timeoutMs);
  });
}

export function debounce<T extends (...args: never[]) => void>(fn: T, waitMs: number): T {
  let timer = 0;
  const wrapped = (...args: never[]): void => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      fn.apply(null, args);
    }, waitMs);
  };
  return wrapped as T;
}

export function formatNumber(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let total = 0;
  for (let index = 0; index < values.length; index += 1) {
    total += values[index];
  }
  return total / values.length;
}

export function setText(node: Element, text: string): void {
  if (node.textContent !== text) {
    node.textContent = text;
  }
}
