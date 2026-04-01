/**
 * Operator list panel — builds, highlights, and manages the instruction list sidebar.
 * Supports tree display with XObject children indented under their parent Do ops.
 */

import type { ContentStreamOp } from '../content-stream';
import { getOpInfo, getCategoryColor, getCategoryLabel } from '../operator-info';
import { decodeForDisplay } from '../display-decode';
import { countOps } from '../op-path';

export class OpListPanel {
  private container: HTMLElement;
  onSeek: ((opIndex: number) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  build(ops: ContentStreamOp[]): void {
    this.container.innerHTML = '';
    let linearIdx = 0;

    const buildLevel = (ops: ContentStreamOp[], depth: number) => {
      for (const op of ops) {
        linearIdx++;
        const el = document.createElement('div');
        el.className = 'op-list-item';
        el.dataset.index = String(linearIdx);
        el.style.paddingLeft = `${8 + depth * 16}px`;

        const num = document.createElement('span');
        num.className = 'op-num';
        num.textContent = String(linearIdx);

        if (op.children) {
          // XObject header row
          el.classList.add('op-xobject-header');
          const badge = document.createElement('span');
          badge.className = 'op-badge xobject';
          badge.textContent = 'XOBJ';

          const opText = document.createElement('span');
          opText.className = 'op-text';
          const childCount = countOps(op.children);
          opText.textContent = `Do ${op.xobjectMeta?.name ?? ''} (${childCount} ops)`;

          el.appendChild(num);
          el.appendChild(badge);
          el.appendChild(opText);
        } else {
          const info = getOpInfo(op.operator);
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
        }

        this.container.appendChild(el);

        const idx = linearIdx;
        el.addEventListener('click', () => this.onSeek?.(idx));

        // Recursively add children
        if (op.children) {
          buildLevel(op.children, depth + 1);
        }
      }
    };

    buildLevel(ops, 0);
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
