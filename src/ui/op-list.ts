/**
 * Operator list panel — builds, highlights, and manages the instruction list sidebar.
 */

import type { ContentStreamOp } from '../content-stream';
import { getOpInfo, getCategoryColor, getCategoryLabel } from '../operator-info';
import { decodeForDisplay } from '../display-decode';

export class OpListPanel {
  private container: HTMLElement;
  onSeek: ((opIndex: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  build(ops: ContentStreamOp[]): void {
    this.container.innerHTML = '';

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const info = getOpInfo(op.operator);
      const el = document.createElement('div');
      el.className = 'op-list-item';
      el.dataset.index = String(i + 1);

      const num = document.createElement('span');
      num.className = 'op-num';
      num.textContent = String(i + 1);

      const badge = document.createElement('span');
      badge.className = 'op-badge';
      badge.style.backgroundColor = getCategoryColor(info.category);
      badge.textContent = getCategoryLabel(info.category);

      const opText = document.createElement('span');
      opText.className = 'op-text';
      opText.textContent = decodeForDisplay(this.formatOpShort(op));

      el.appendChild(num);
      el.appendChild(badge);
      el.appendChild(opText);
      this.container.appendChild(el);

      el.addEventListener('click', () => this.onSeek?.(i + 1));
    }
  }

  highlight(currentOp: number): void {
    this.container.querySelectorAll('.op-list-item').forEach((el) => {
      const idx = parseInt((el as HTMLElement).dataset.index!, 10);
      el.classList.toggle('active', idx === currentOp);
      el.classList.toggle('past', idx < currentOp);
    });

    const activeItem = this.container.querySelector('.op-list-item.active');
    if (activeItem) {
      activeItem.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  private formatOpShort(op: ContentStreamOp): string {
    const parts = op.operands.slice(0, 4);
    const operandStr = parts.join(' ');
    const truncated = operandStr.length > 30
      ? operandStr.substring(0, 27) + '...'
      : operandStr;
    return truncated ? `${truncated} ${op.operator}` : op.operator;
  }
}
