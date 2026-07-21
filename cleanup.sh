@echo off
REM Batch script to clean up API keys from config.ts

REM Read the config file and write cleaned version
python3 clean_config.py > nul 2>&1

REM Check if there are any VITE_ references left
grep -r "VITE_" src/ --include="*.ts" --include="*.tsx" | find /c /v "" > temp_count.txt
set /p count=<temp_count.txt
del temp_count.txt

if %count%==0 (
    echo All VITE_ environment variables removed
) else (
    echo WARNING: %count% lines still contain VITE_ variables
)
