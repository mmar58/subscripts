import fs from 'fs';
import path from 'path';
import { CACHE_FILE } from './config.js';
import { formatBytes, formatTime, printTable } from './utils/formatters.js';
import { callAria2 } from './services/aria2c.js';
import { fetchSizeFromUrl } from './services/httpSize.js';
import { getDriveStorage } from './services/storage.js';
let sizeCache = {};
if (fs.existsSync(CACHE_FILE)) {
    try {
        sizeCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    }
    catch (e) {
        sizeCache = {};
    }
}
async function generateReport() {
    console.clear();
    console.log('\x1b[36m========================================================================================\x1b[0m');
    console.log('\x1b[1m\x1b[33m                          ARIA2C DOWNLOADS & STORAGE REPORT                            \x1b[0m');
    console.log('\x1b[36m========================================================================================\x1b[0m\n');
    const [active, waiting, stopped, globalStat] = await Promise.all([
        callAria2('tellActive'),
        callAria2('tellWaiting', [0, 100]),
        callAria2('tellStopped', [0, 100]),
        callAria2('getGlobalStat')
    ]);
    const allDownloads = [...active, ...waiting, ...stopped];
    if (allDownloads.length === 0) {
        console.log('\x1b[90mNo downloads found in the active, queued, or stopped session.\x1b[0m\n');
        return;
    }
    const trackedDrives = new Set();
    const pendingBytesByRoot = new Map();
    const speedBytesByRoot = new Map();
    const tableData = [];
    const newSizeCache = {};
    let cacheModified = false;
    // Process downloads sequentially to allow dynamic terminal logging
    for (let i = 0; i < allDownloads.length; i++) {
        const dl = allDownloads[i];
        let fileDir = dl.dir || 'Unknown';
        let fileName = 'Unknown';
        let sourceUrl = '';
        if (dl.files && dl.files.length > 0) {
            const fileData = dl.files[0];
            if (fileData.path) {
                fileName = path.basename(fileData.path);
                fileDir = path.dirname(fileData.path);
            }
            else if (dl.bittorrent?.info?.name) {
                fileName = dl.bittorrent.info.name;
            }
            else if (fileData.uris && fileData.uris.length > 0) {
                sourceUrl = fileData.uris[0].uri;
                try {
                    const urlObj = new URL(sourceUrl);
                    fileName = path.basename(urlObj.pathname) || urlObj.hostname;
                }
                catch (e) {
                    fileName = sourceUrl;
                }
            }
        }
        trackedDrives.add(fileDir);
        let totalBytes = Number(dl.totalLength) || 0;
        const completedBytes = Number(dl.completedLength) || 0;
        // --- DYNAMIC TERMINAL LOGGING & SIZE FETCHING ---
        if (totalBytes === 0 && sourceUrl && dl.status !== 'complete') {
            if (sizeCache[sourceUrl]) {
                totalBytes = sizeCache[sourceUrl];
                newSizeCache[sourceUrl] = totalBytes;
                process.stdout.write(`\r\x1b[K\x1b[36m[Processing ${i + 1}/${allDownloads.length}]\x1b[0m ${fileName}`);
            }
            else {
                // \r returns cursor to start of line, \x1b[K clears the line
                process.stdout.write(`\r\x1b[K\x1b[33m[Analyzing ${i + 1}/${allDownloads.length}]\x1b[0m Fetching remote size for: ${fileName}`);
                const fetchedSize = await fetchSizeFromUrl(sourceUrl);
                if (fetchedSize > 0) {
                    totalBytes = fetchedSize;
                    newSizeCache[sourceUrl] = fetchedSize;
                    cacheModified = true;
                }
            }
        }
        else {
            // Just update the processing indicator for files that already have a size
            process.stdout.write(`\r\x1b[K\x1b[36m[Processing ${i + 1}/${allDownloads.length}]\x1b[0m ${fileName}`);
        }
        const remainingBytes = Math.max(0, totalBytes - completedBytes);
        const downloadSpeed = Number(dl.downloadSpeed) || 0;
        if (fileDir !== 'Unknown') {
            const rootDrive = path.parse(path.resolve(fileDir)).root.toUpperCase();
            const currentPending = pendingBytesByRoot.get(rootDrive) || 0;
            pendingBytesByRoot.set(rootDrive, currentPending + remainingBytes);
            const currentSpeed = speedBytesByRoot.get(rootDrive) || 0;
            speedBytesByRoot.set(rootDrive, currentSpeed + downloadSpeed);
        }
        let statusFormatted = dl.status.toUpperCase();
        if (dl.status === 'active')
            statusFormatted = `\x1b[32m${statusFormatted}\x1b[0m`;
        else if (dl.status === 'waiting' || dl.status === 'paused')
            statusFormatted = `\x1b[33m${statusFormatted}\x1b[0m`;
        else if (dl.status === 'complete')
            statusFormatted = `\x1b[36m${statusFormatted}\x1b[0m`;
        else if (dl.status === 'error')
            statusFormatted = `\x1b[31m${statusFormatted}\x1b[0m`;
        let progressString = `${formatBytes(completedBytes)} / ${formatBytes(totalBytes)}`;
        if (totalBytes === 0 && dl.status !== 'complete') {
            progressString = `\x1b[90mSize Hidden/Failed\x1b[0m`;
        }
        else if (totalBytes > 0 && dl.totalLength === '0') {
            progressString += ` \x1b[33m(Estim.)\x1b[0m`; // Flag sizes fetched via HTTP HEAD
        }
        let speedStr = '-';
        let etaStr = '-';
        if (dl.status === 'active') {
            speedStr = `${formatBytes(downloadSpeed)}/s`;
            if (downloadSpeed > 0 && totalBytes > completedBytes) {
                etaStr = formatTime(remainingBytes / downloadSpeed);
            }
            else if (downloadSpeed === 0 && totalBytes > completedBytes) {
                etaStr = '∞';
            }
        }
        tableData.push({
            Name: fileName.length > 35 ? fileName.substring(0, 32) + '...' : fileName,
            Status: statusFormatted,
            Progress: progressString,
            Speed: speedStr,
            ETA: etaStr,
            'Save Location': fileDir
        });
    }
    // Clear the dynamic logging line entirely before printing the tables
    process.stdout.write('\r\x1b[K');
    const globalDlSpeed = Number(globalStat.downloadSpeed) || 0;
    console.log(`\x1b[1m\x1b[34m--- ACTIVE & RECENT DOWNLOADS ---\x1b[0m  |  Total Speed: \x1b[32m${formatBytes(globalDlSpeed)}/s\x1b[0m`);
    printTable(tableData);
    console.log('\n\x1b[1m\x1b[34m--- DRIVE STORAGE ANALYSIS (POST-DOWNLOAD ESTIMATE) ---\x1b[0m');
    const uniqueRoots = new Map();
    trackedDrives.forEach((dir) => {
        if (dir !== 'Unknown') {
            const rootDrive = path.parse(path.resolve(dir)).root.toUpperCase();
            if (!uniqueRoots.has(rootDrive)) {
                const pendingForDrive = pendingBytesByRoot.get(rootDrive) || 0;
                const storageInfo = getDriveStorage(dir, pendingForDrive);
                if (!storageInfo.error)
                    uniqueRoots.set(rootDrive, storageInfo);
            }
        }
    });
    const storageTable = [];
    uniqueRoots.forEach((info) => {
        const rootDrive = info.root;
        const pendingForDrive = pendingBytesByRoot.get(rootDrive) || 0;
        const speedForDrive = speedBytesByRoot.get(rootDrive) || 0;
        let etaStr = '-';
        if (speedForDrive > 0 && pendingForDrive > 0) {
            etaStr = formatTime(pendingForDrive / speedForDrive);
        }
        else if (speedForDrive === 0 && pendingForDrive > 0) {
            etaStr = '∞';
        }
        storageTable.push({
            'Drive': info.root,
            'Total Cap.': info.total,
            'Current Free': info.currentFree,
            'Incoming Data': info.pendingAllocation,
            'Est. Free After DL': info.estimatedFree,
            'Est. Free %': info.estimatedFreePercent,
            'ETA': etaStr
        });
    });
    if (storageTable.length > 0) {
        printTable(storageTable);
    }
    else {
        console.log('\x1b[90mNo valid disk paths found to analyze.\x1b[0m');
    }
    if (Object.keys(sizeCache).length !== Object.keys(newSizeCache).length || cacheModified) {
        try {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(newSizeCache, null, 2), 'utf8');
        }
        catch (err) {
            console.error('\x1b[31mFailed to save link sizes cache.\x1b[0m');
        }
    }
    console.log('\x1b[36m========================================================================================\x1b[0m\n');
}
generateReport();
