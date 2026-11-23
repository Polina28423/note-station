from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
import json
root = Path(__file__).resolve().parent.parent
class Preview(BaseHTTPRequestHandler):
    def do_GET(self):
        name = self.path.split('?')[0]
        if name in ['/', '/login', '/block-editor-check.html']:
            source = (root/'ui/index.html').read_text(encoding='utf-8')
            if name == '/':
                source = source.replace('<script type="module" src="app.js">', '<script src="/mock-api.js"></script><script type="module" src="app.js">')
            elif name == '/block-editor-check.html':
                source = source.replace('src="app.js"', 'src="/block-editor-check.js"')
            data = source.encode()
            mime = 'text/html; charset=utf-8'
        elif name in ['/content-check.html','/content-check.js','/editor-check.html','/editor-check.js','/block-editor-check.js','/style.css','/notestation.css','/panels.js','/startup.js','/editor.js','/block-editor.js','/classic-editor.js','/editor-document.js','/editor-focus.js','/editor-styles.js','/app.js','/history.js','/strings.js','/spelling.js','/spelling-adapter.js','/links.js','/settings.js','/collections.js','/content.js','/preferences.js','/library.js','/mock-api.js']:
            path = root / ('tests' if name in ['/mock-api.js','/content-check.html','/content-check.js','/editor-check.html','/editor-check.js','/block-editor-check.js'] else 'ui') / name[1:]
            data = path.read_bytes(); mime = 'text/html; charset=utf-8' if name.endswith('.html') else 'text/css' if name.endswith('.css') else 'text/javascript'
        elif name in ['/note-tags.js','/images.js','/image-controls.js','/note-html.js','/paste-normalizer.js','/youtube.js','/video-edit.js','/video-editor.css','/table-dialog.js']:
            data = (root/'ui'/name[1:]).read_bytes(); mime = 'text/css' if name.endswith('.css') else 'text/javascript'
        elif name.startswith('/vendor/'):
            path = (root/'ui'/name.lstrip('/')).resolve()
            if not path.is_relative_to((root/'ui/vendor').resolve()) or not path.is_file():
                self.send_error(404); return
            data = path.read_bytes(); mime = 'text/css' if path.suffix == '.css' else 'text/javascript'
        else:
            self.send_error(404); return
        self.send_response(200);
        if name in ['/', '/login', '/editor-check.html', '/block-editor-check.html']:
            self.send_header('Content-Security-Policy', json.loads((root/'src-tauri/tauri.conf.json').read_text())['app']['security']['csp'])
        self.send_header('Content-Type', mime); self.send_header('Content-Length', str(len(data))); self.end_headers(); self.wfile.write(data)
if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, default=8765)
    server = HTTPServer(('127.0.0.1', parser.parse_args().port), Preview)
    print(f'PREVIEW_PORT={server.server_port}', flush=True)
    server.serve_forever()
