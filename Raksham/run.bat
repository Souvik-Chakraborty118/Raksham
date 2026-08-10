@echo off
echo Starting Trana Backend Server...
echo Press Ctrl+C to stop the server.
echo ------------------------------------------------
python -m uvicorn main:app --reload
pause