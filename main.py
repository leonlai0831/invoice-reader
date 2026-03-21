"""
Invoice Reader Desktop App
Run: python main.py
Build exe: build.bat  (uses PyInstaller)
"""

import os
import sys

# Fix OpenSSL 3.0 legacy provider error (affects cryptography/pdfplumber on some systems)
os.environ.setdefault('CRYPTOGRAPHY_OPENSSL_NO_LEGACY', '1')

import threading
import logging

import webview
from flask import Flask, render_template

from persistence import setup_logging, logger
from routes import register_blueprints

# ── PyInstaller resource path ────────────────────────────────────

def resource_path(relative_path):
    """Get path to resource — works both in dev and inside PyInstaller exe."""
    if getattr(sys, '_MEIPASS', None):
        return os.path.join(sys._MEIPASS, relative_path)
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), relative_path)


# ── Version ──────────────────────────────────────────────────────

def _read_version():
    """Read version from VERSION file."""
    try:
        vpath = resource_path("VERSION")
        with open(vpath, encoding="utf-8") as f:
            return f.read().strip()
    except FileNotFoundError:
        return "dev"

__version__ = _read_version()


# ── Flask app ────────────────────────────────────────────────────

app = Flask(
    __name__,
    template_folder=resource_path('templates'),
    static_folder=resource_path('static'),
)
app.secret_key = os.urandom(32)

logger.setLevel(logging.INFO)

register_blueprints(app)


# ── CSRF protection: require custom header on state-mutating requests ──

@app.before_request
def _csrf_check():
    """Block cross-origin POST/DELETE/PUT/PATCH requests.

    pywebview and the app's own JS set 'X-Requested-With: InvoiceReader'.
    Browsers block cross-origin custom headers without CORS preflight,
    so a malicious page on the same machine cannot forge this header.
    """
    from flask import request as req
    if req.method in ("POST", "DELETE", "PUT", "PATCH"):
        if req.headers.get("X-Requested-With") != "InvoiceReader":
            from flask import jsonify
            return jsonify({"ok": False, "error": "Missing or invalid request header"}), 403


@app.route('/')
def index():
    return render_template('index.html')


# ── Launch ───────────────────────────────────────────────────────

def _find_free_port(preferred=7788):
    """Find a free port, preferring the given one."""
    import socket
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            s.bind(('127.0.0.1', preferred))
            return preferred
    except OSError:
        pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


_flask_port = 7788


def _start_flask():
    """Run Flask in a background thread so the main thread can own the GUI."""
    app.run(host='127.0.0.1', port=_flask_port, debug=False, use_reloader=False)


if __name__ == '__main__':
    _flask_port = _find_free_port()

    # Flask on daemon thread — dies automatically when window closes
    t = threading.Thread(target=_start_flask, daemon=True)
    t.start()

    # Native desktop window (Edge WebView2 on Windows)
    webview.create_window(
        f'Invoice Reader v{__version__} — Optimum Group',
        f'http://localhost:{_flask_port}',
        width=1440,
        height=900,
        min_size=(900, 600),
    )
    webview.start()  # blocks until user closes the window
