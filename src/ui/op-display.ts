/**
 * Operator display — shows the current operator's info (badge, raw code, description).
 */

import type { ContentStreamOp } from '../content-stream';
import { getOpInfo, getCategoryColor, getCategoryLabel } from '../operator-info';
import { decodeForDisplay } from '../display-decode';

export class OpDisplay {
  private container: HTMLElement;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  update(ops: ContentStreamOp[], currentOp: number): void {
    if (currentOp === 0) {
      this.container.innerHTML = `
        <div class="op-current">
          <span class="op-current-label">Ready</span>
          <span class="op-current-desc">No operators executed</span>
        </div>
      `;
    } else {
      const op = ops[currentOp - 1];
      const info = getOpInfo(op.operator);
      this.container.innerHTML = `
        <div class="op-current">
          <span class="op-badge" style="background-color: ${getCategoryColor(info.category)}">${getCategoryLabel(info.category)}</span>
          <code class="op-current-code">${this.escapeHtml(decodeForDisplay(op.raw))}</code>
          <span class="op-current-desc">${info.description}</span>
        </div>
      `;
    }
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
