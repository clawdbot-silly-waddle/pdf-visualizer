/**
 * Operator display — shows the current operator's info (badge, raw code, description).
 * Displays breadcrumb context when inside XObject children.
 */

import type { ContentStreamOp } from '../content-stream';
import { getOpInfo, getCategoryColor, getCategoryLabel } from '../operator-info';
import { decodeForDisplay } from '../display-decode';
import { linearToPath, opAtPath, pathDepth } from '../op-path';

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
      return;
    }

    const path = linearToPath(ops, currentOp);
    const op = opAtPath(ops, path);

    if (!op) {
      this.container.innerHTML = `
        <div class="op-current">
          <span class="op-current-label">Op ${currentOp}</span>
        </div>
      `;
      return;
    }

    const info = getOpInfo(op.operator);

    // Build breadcrumb for nested context
    let breadcrumb = '';
    if (path.length > 1) {
      const crumbs: string[] = ['Page'];
      let current = ops;
      for (let i = 0; i < path.length - 1; i++) {
        const parentOp = current[path[i]];
        if (parentOp?.xobjectMeta) {
          crumbs.push(parentOp.xobjectMeta.name);
        }
        if (parentOp?.children) {
          current = parentOp.children;
        }
      }
      breadcrumb = `<span class="op-breadcrumb">${this.escapeHtml(crumbs.join(' › '))}</span>`;
    }

    this.container.innerHTML = `
      <div class="op-current">
        ${breadcrumb}
        <span class="op-badge" style="background-color: ${getCategoryColor(info.category)}">${getCategoryLabel(info.category)}</span>
        <code class="op-current-code">${this.escapeHtml(decodeForDisplay(op.raw))}</code>
        <span class="op-current-desc">${info.description}</span>
      </div>
    `;
  }

  private escapeHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
}
