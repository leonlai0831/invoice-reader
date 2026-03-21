# -*- mode: python ; coding: utf-8 -*-
from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = [
    'flask', 'werkzeug', 'requests', 'openpyxl',
    'jinja2', 'click', 'itsdangerous', 'markupsafe',
    'webview', 'webview.platforms.edgechromium', 'webview.platforms.winforms',
    'clr_loader', 'pythonnet',
    'pdfplumber', 'pdfminer', 'pdfminer.high_level', 'pdfminer.layout',
    'pypdfium2',
]

# Collect Flask / Werkzeug / Jinja2 / WebView / pdfplumber internals
for pkg in ('flask', 'werkzeug', 'jinja2', 'webview', 'pdfplumber', 'pdfminer'):
    d, b, h = collect_all(pkg)
    datas += d; binaries += b; hiddenimports += h

# ── App-specific data files (only non-Python assets) ─────────────
datas += [
    ('templates', 'templates'),
    ('static',    'static'),
    ('VERSION',   '.'),
]

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Unused stdlib modules — reduces exe size
        'unittest', 'test', 'tests',
        'xmlrpc', 'email',
        'multiprocessing', 'concurrent',
        'lib2to3', 'ensurepip', 'venv',
        'distutils', 'setuptools', 'pip',
        'sqlite3',
    ],
    noarchive=False,
    optimize=1,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Invoice Reader',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
