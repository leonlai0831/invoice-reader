@echo off
chcp 65001 >nul

:: Read version from VERSION file
set /p APP_VERSION=<VERSION
echo ════════════════════════════════════════════
echo   Invoice Reader v%APP_VERSION% — Build EXE
echo ════════════════════════════════════════════
echo.

echo [1/5] Installing Python dependencies (locked)...
pip install -r requirements-lock.txt --quiet
if errorlevel 1 (
    echo ERROR: pip install failed
    pause
    exit /b 1
)

echo [2/5] Installing Node dependencies...
call npm ci --silent
if errorlevel 1 (
    echo ERROR: npm ci failed
    pause
    exit /b 1
)

echo [3/5] Building frontend (Vite + TypeScript)...
call npm run build
if errorlevel 1 (
    echo ERROR: Vite build failed
    pause
    exit /b 1
)

echo [4/5] Cleaning previous build...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [5/5] Building exe with PyInstaller...
pyinstaller --clean --noconfirm "Invoice Reader.spec"
echo.

if exist "dist\Invoice Reader.exe" (
    echo ════════════════════════════════════════════
    echo   SUCCESS! v%APP_VERSION%
    echo   dist\Invoice Reader.exe
    echo ════════════════════════════════════════════
    explorer dist
) else (
    echo ════════════════════════════════════════════
    echo   BUILD FAILED — check errors above
    echo ════════════════════════════════════════════
)
pause
