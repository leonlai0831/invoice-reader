@echo off
chcp 65001 >nul
echo ════════════════════════════════════════════
echo   Invoice Reader — Build EXE
echo ════════════════════════════════════════════
echo.

echo [1/4] Installing dependencies...
pip install -r requirements.txt --quiet --upgrade
if errorlevel 1 (
    echo ERROR: pip install failed
    pause
    exit /b 1
)

echo [2/4] Building frontend (Vite + TypeScript)...
call npm run build
if errorlevel 1 (
    echo ERROR: Vite build failed
    pause
    exit /b 1
)

echo [3/4] Cleaning previous build...
if exist build rmdir /s /q build
if exist dist rmdir /s /q dist

echo [4/4] Building exe with PyInstaller...
pyinstaller --clean --noconfirm "Invoice Reader.spec"
echo.

if exist "dist\Invoice Reader.exe" (
    echo ════════════════════════════════════════════
    echo   SUCCESS!
    echo   dist\Invoice Reader.exe
    echo ════════════════════════════════════════════
    explorer dist
) else (
    echo ════════════════════════════════════════════
    echo   BUILD FAILED — check errors above
    echo ════════════════════════════════════════════
)
pause
