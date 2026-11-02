"""Static server that gzips like GitHub Pages does (for realistic load-time tests).
usage: python3 tools/serve_gz.py <dir> <port>"""
import gzip, http.server, os, sys, functools
GZ = {'.js', '.mjs', '.css', '.html', '.json', '.svg', '.wasm', '.txt'}
cache = {}
class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.wasm': 'application/wasm', '.js': 'text/javascript', '.mjs': 'text/javascript'}
    def log_message(self, *a): pass
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path): path = os.path.join(path, 'index.html')
        ext = os.path.splitext(path)[1].lower()
        if ext in GZ and 'gzip' in self.headers.get('Accept-Encoding', '') and os.path.isfile(path):
            st = os.stat(path); key = (path, st.st_mtime)
            if key not in cache: cache[key] = gzip.compress(open(path, 'rb').read(), 6)
            body = cache[key]
            self.send_response(200)
            self.send_header('Content-Type', self.guess_type(path)); self.send_header('Content-Encoding', 'gzip')
            self.send_header('Content-Length', str(len(body))); self.send_header('Cache-Control', 'max-age=600')
            self.end_headers()
            import io; return io.BytesIO(body)
        return super().send_head()
d, port = sys.argv[1], int(sys.argv[2])
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=d)).serve_forever()
