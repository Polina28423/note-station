import { ClassicSurface as NoteEditor } from '/classic-editor.js';
const result = document.getElementById('results');
const checks = [];
function check(value, name) { if (!value) throw Error(name); checks.push('PASS ' + name); }
try {
 const context = { update(){}, clean:NoteEditor.prototype.clean };
 await NoteEditor.prototype.init.call(context);
 const original = '<p style="text-align: center;">Original text</p><img src="original-relative.png" class="syno-notestation-image-object" data-file-id="existing" file_id="legacy-attribute"><embed src="existing.pdf" type="application/pdf">';
 const protectedHTML = NoteEditor.prototype.protectMedia.call(context, original);
 context.editor.setContent(protectedHTML); context.baseline = context.editor.getContent(); context.note={content:original};
 check(!context.editor.getBody().querySelector('img,embed'),'media never loaded into editable document');
 check(context.editor.getBody().querySelectorAll('[data-note-protected]').length === 2,'protected placeholders survive TinyMCE normalization');
 check(NoteEditor.prototype.output.call(context) === original,'title-only edit preserves exact original HTML');
 context.editor.insertContent('<p>New paragraph</p>');
 const edited = NoteEditor.prototype.output.call(context);
 const template = document.createElement('template'); template.innerHTML=edited;
 check(template.content.querySelector('img')?.getAttribute('file_id') === 'legacy-attribute','original attachment metadata retained after body edit');
 check(template.content.querySelector('img')?.getAttribute('src') === 'original-relative.png','relative media URL retained');
 check(template.content.querySelector('embed')?.getAttribute('src') === 'existing.pdf','existing PDF reference retained');
 check(!edited.includes('data-note-protected'),'internal editor placeholders not sent to NAS');
 const clean = context.clean('<p onclick="alert(1)">Text</p><script>alert(1)</script><iframe src="https://untrusted.invalid"></iframe>');
 const safe = document.createElement('template');safe.innerHTML=clean;
 check(!safe.content.querySelector('script,iframe,[onclick]'),'new executable content removed before save');
 result.textContent=checks.join('\n');
} catch(error) { result.textContent=checks.join('\n')+'\nFAIL '+error.message; }
