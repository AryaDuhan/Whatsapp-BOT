@echo off
REM
echo 🚀 Starting WhatsApp Attendance Bot...

REM check if node.js is installed
node --version >nul 2>&1
if errorlevel 1 (
    echo ❌ Node.js is not installed. Please install Node.js v14 or higher.
    pause
    exit /b 1
)

REM check if npm is installed
npm --version >nul 2>&1
if errorlevel 1 (
    echo ❌ npm is not installed. Please install npm.
    pause
    exit /b 1
)

REM create necessary directories
echo 📁 Creating directories...
if not exist "whatsapp-session" mkdir whatsapp-session
if not exist "logs" mkdir logs

REM check if .env file exists
if not exist ".env" (
    echo ⚠️  .env file not found.
    echo Please create a .env file with your configuration.
    echo You can copy the example from the README.md file.
    echo.
    echo Example .env content:
    echo MONGODB_URI=mongodb://localhost:27017/attendance_bot
    echo DEFAULT_TIMEZONE=Asia/Kolkata
    echo.
    pause
)

REM install dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ❌ Failed to install dependencies.
        pause
        exit /b 1
    )
)

REM start the bot
echo 🤖 Starting the bot...
echo 📱 Make sure your phone is ready to scan the QR code!
echo 🔍 Bot logs will appear below...
echo -------------------------------------------
echo.

REM check if development mode
if "%NODE_ENV%"=="development" (
    call npm run dev
) else (
    call npm start
)

pause