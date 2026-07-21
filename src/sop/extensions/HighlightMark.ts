import { Mark, mergeAttributes } from '@tiptap/core';

export interface HighlightMarkOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    highlightMark: {
      setHighlightMark: (attrs: {
        kind: string;
        issueId?: string;
        score?: string;
        text?: string;
        reason?: string;
        label?: string;
        cls: string;
      }) => ReturnType;
      unsetHighlightMark: () => ReturnType;
    };
  }
}

export const HighlightMark = Mark.create<HighlightMarkOptions>({
  name: 'highlightMark',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  addAttributes() {
    return {
      kind: { default: null, parseHTML: el => el.getAttribute('data-kind'), renderHTML: attrs => attrs.kind ? { 'data-kind': attrs.kind } : {} },
      issueId: { default: null, parseHTML: el => el.getAttribute('data-issue-id'), renderHTML: attrs => attrs.issueId ? { 'data-issue-id': attrs.issueId } : {} },
      score: { default: null, parseHTML: el => el.getAttribute('data-score'), renderHTML: attrs => attrs.score ? { 'data-score': attrs.score } : {} },
      text: { default: null, parseHTML: el => el.getAttribute('data-text'), renderHTML: attrs => attrs.text ? { 'data-text': attrs.text } : {} },
      reason: { default: null, parseHTML: el => el.getAttribute('data-reason'), renderHTML: attrs => attrs.reason ? { 'data-reason': attrs.reason } : {} },
      label: { default: null, parseHTML: el => el.getAttribute('data-label'), renderHTML: attrs => attrs.label ? { 'data-label': attrs.label } : {} },
      cls: { default: null, parseHTML: el => el.getAttribute('class'), renderHTML: attrs => attrs.cls ? { class: attrs.cls } : {} },
    };
  },

  parseHTML() {
    return [{ tag: 'mark' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mark', mergeAttributes(this.options.HTMLAttributes, HTMLAttributes), 0];
  },

  addCommands() {
    return {
      setHighlightMark: (attrs) => ({ commands }) => {
        return commands.setMark(this.name, attrs);
      },
      unsetHighlightMark: () => ({ commands }) => {
        return commands.unsetMark(this.name);
      },
    };
  },
});
