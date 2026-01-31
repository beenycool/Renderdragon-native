const { app, BrowserWindow, globalShortcut, ipcMain, dialog, clipboard, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const os = require('os');

let mainWindow = null;
let isVisible = false;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        frame: false,
        transparent: true,
        resizable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

    // Hide when loses focus
    mainWindow.on('blur', () => {
        hideWindow();
    });

    // Center window on screen
    mainWindow.center();
}

function showWindow() {
    if (mainWindow) {
        mainWindow.center();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('window-shown');
        isVisible = true;
    }
}

function hideWindow() {
    if (mainWindow) {
        mainWindow.hide();
        mainWindow.webContents.send('window-hidden');
        isVisible = false;
    }
}

function toggleWindow() {
    if (isVisible) {
        hideWindow();
    } else {
        showWindow();
    }
}

// Helper function to download file to buffer
function downloadToBuffer(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (response) => {
            const chunks = [];
            response.on('data', chunk => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

app.whenReady().then(() => {
    createWindow();

    // Register global shortcut (Ctrl+Space)
    const registered = globalShortcut.register('CommandOrControl+Space', () => {
        toggleWindow();
    });

    if (!registered) {
        console.error('Failed to register global shortcut');
    }

    // IPC handlers
    ipcMain.handle('hide-window', () => {
        hideWindow();
    });

    ipcMain.handle('download-asset', async (event, url, filename) => {
        try {
            const result = await dialog.showSaveDialog(mainWindow, {
                defaultPath: filename,
                filters: [{ name: 'All Files', extensions: ['*'] }]
            });

            if (result.canceled || !result.filePath) {
                return { success: false, message: 'Download canceled' };
            }

            return new Promise((resolve) => {
                const protocol = url.startsWith('https') ? https : http;
                const file = fs.createWriteStream(result.filePath);

                protocol.get(url, (response) => {
                    response.pipe(file);
                    file.on('finish', () => {
                        file.close();
                        resolve({ success: true, path: result.filePath });
                    });
                }).on('error', (err) => {
                    fs.unlink(result.filePath, () => { });
                    resolve({ success: false, message: err.message });
                });
            });
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    // Copy to clipboard handler
    ipcMain.handle('copy-to-clipboard', async (event, url, filename, ext) => {
        try {
            const buffer = await downloadToBuffer(url);
            const extension = ext.toLowerCase();

            // For images, copy as image
            if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(extension)) {
                const image = nativeImage.createFromBuffer(buffer);
                clipboard.writeImage(image);
                return { success: true, type: 'image' };
            }

            // For other files, save to temp and copy file to clipboard using PowerShell
            const tempDir = os.tmpdir();
            const tempPath = path.join(tempDir, filename);
            fs.writeFileSync(tempPath, buffer);

            // Copy file to clipboard (Windows-specific using PowerShell)
            if (process.platform === 'win32') {
                const { exec } = require('child_process');
                return new Promise((resolve) => {
                    // Use PowerShell to copy file to clipboard
                    const psCommand = `Set-Clipboard -Path "${tempPath}"`;
                    exec(`powershell -command "${psCommand}"`, (error) => {
                        if (error) {
                            resolve({ success: false, message: error.message });
                        } else {
                            resolve({ success: true, type: 'file', path: tempPath });
                        }
                    });
                });
            } else {
                // For other platforms, just copy the path as text
                clipboard.writeText(tempPath);
                return { success: true, type: 'path', path: tempPath };
            }
        } catch (error) {
            return { success: false, message: error.message };
        }
    });

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('will-quit', () => {
    globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
