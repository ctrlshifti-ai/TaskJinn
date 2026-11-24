// Rich text editor (Quill) used for task descriptions and comments.
// Read-only until `editing` is true; the toolbar only shows while editing.

import { toDisplayHtml, toSavedHtml } from './util.js';

const TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }, { list: 'check' }],
  ['blockquote', 'code-block', 'link', 'image'],
  ['clean'],
];

// Quill only allows http(s) and data: images by default. Also allow attachment: links,
// which point at images in the organization's attachments folder.
const BaseImage = Quill.import('formats/image');
class AttachmentImage extends BaseImage {
  static sanitize(url) {
    return /^(attachment:|data:image\/|https?:)/i.test(url) ? url : '//:0';
  }
}
Quill.register(AttachmentImage, true);

export const RichText = {
  props: {
    html: { type: String, default: '' },
    editing: { type: Boolean, default: false },
    attachmentsDir: { type: String, default: '' },
    placeholder: { type: String, default: '' },
  },
  template: `<div class="richtext" :class="{ editing }"><div ref="editor"></div></div>`,

  mounted() {
    // Kept outside Vue's reactivity on purpose: Quill manages its own state.
    this.quill = new Quill(this.$refs.editor, {
      theme: 'snow',
      readOnly: !this.editing,
      placeholder: this.placeholder,
      modules: { toolbar: TOOLBAR },
    });
    this.show();
    if (this.editing) this.quill.focus();
  },

  watch: {
    html() {
      if (!this.editing) this.show();
    },
    editing(on) {
      if (!on) this.show();   // Cancel: go back to the saved text
      this.quill.enable(on);
      if (on) this.quill.focus();
    },
  },

  methods: {
    show() {
      const html = toDisplayHtml(this.html || '', this.attachmentsDir);
      this.quill.setContents(this.quill.clipboard.convert({ html }), 'silent');
      this.quill.history.clear();
    },
    /** The current content as HTML to save ('' when empty). */
    getHtml() {
      return this.quill.getLength() <= 1 ? '' : toSavedHtml(this.quill.root.innerHTML);
    },
    clear() {
      this.quill.setContents([], 'silent');
    },
  },
};
