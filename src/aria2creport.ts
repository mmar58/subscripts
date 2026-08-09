import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ==========================================
// Environment & Arguments Parsing
// ==========================================
const ENV_FILE = path.join(__dirname, '.env');
if (fs.existsSync(ENV_FILE)) {
    const envData = fs.readFileSync(ENV_FILE, 'utf8');
    envData.split('\n').forEach(line => {
        const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
        if (match) {
            const key = match[1];
            let value = match[2] || '';
            if (value.length > 0 && value.charAt(0) === '"' && value.charAt(value.length - 1) === '"') {
                value = value.replace(/\\n/gm, '\n');
            }
            value = value.replace(/(^['"]|['"]$)/g, '').trim();
            if (!process.env[key]) {
                process.env[key] = value;
            }
        }
    });
}

const argv = process.argv.slice(2);
let argsRpcUrl: string | null = null;
let argsRpcSecret: string | null = null;
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rpc-url' && argv[i + 1]) {
        argsRpcUrl = argv[++i];
    } else if (argv[i].startsWith('--rpc-url=')) {
        argsRpcUrl = argv[i].substring('--rpc-url='.length);
    } else if (argv[i] === '--rpc-secret' && argv[i + 1]) {
        argsRpcSecret = argv[++i];
    } else if (argv[i].startsWith('--rpc-secret=')) {
        argsRpcSecret = argv[i].substring('--rpc-secret='.length);
    }
}

// ==========================================
// Configuration
// ==========================================
const RPC_URL = argsRpcUrl || process.env.RPC_URL || 'http://localhost:6800/jsonrpc';
const RPC_SECRET = argsRpcSecret || process.env.RPC_SECRET || 'mmarWinPc582c';
const USER_AGENT = 'Transmission/2.94'; // Matches your aria2c config

const CACHE_FILE = path.join(__dirname, 'link_sizes.json');
let sizeCache: Record<string, number> = {};
if (fs.existsSync(CACHE_FILE)) {
    try {
        sizeCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
    } catch (e) {
        sizeCache = {};
    }
}

// Helper to format raw bytes into human-readable strings
function formatBytes(bytes: number | string): string {
    bytes = Number(bytes);
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper to format time (in seconds) into a readable string
function formatTime(seconds: number): string {
    if (!isFinite(seconds) || seconds <= 0) return '-';
    seconds = Math.floor(seconds);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
}

// Make JSON-RPC request to aria2c
async function callAria2(method: string, params: any[] = []): Promise<any> {
    const payload = {
        jsonrpc: '2.0',
        id: Date.now().toString(),
        method: `aria2.${method}`,
        params: [`token:${RPC_SECRET}`, ...params]
    };

    try {
        const response = await fetch(RPC_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        const data = await response.json() as any;
        if (data.error) throw new Error(`RPC Error: ${data.error.message}`);
        return data.result;
    } catch (err) {
        console.error(`\x1b[31mFailed to connect to aria2c RPC at ${RPC_URL}\x1b[0m`);
        process.exit(1);
    }
}

// Perform an HTTP HEAD request to fetch file size without downloading it
async function fetchSizeFromUrl(url: string): Promise<number> {
    try {
        // Use a short 3-second timeout so the script doesn't hang on dead links
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);

        const response = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': USER_AGENT },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (response.ok) {
            const contentLength = response.headers.get('content-length');
            if (contentLength) return parseInt(contentLength, 10);
        }
    } catch (err) {
        // Ignore timeouts and network errors, just return 0 as fallback
    }
    return 0;
}

// Calculate free, total, and estimated disk space
function getDriveStorage(dirPath: string, pendingBytes: number = 0) {
    try {
        const resolvedPath = path.resolve(dirPath);
        const rootDrive = path.parse(resolvedPath).root;
        const stats = fs.statfsSync(rootDrive);

        const totalBytes = stats.bsize * stats.blocks;
        const freeBytes = stats.bsize * stats.bavail;
        const estimatedFreeBytes = Math.max(0, freeBytes - pendingBytes);

        return {
            root: rootDrive.toUpperCase(),
            total: formatBytes(totalBytes),
            currentFree: formatBytes(freeBytes),
            pendingAllocation: formatBytes(pendingBytes),
            estimatedFree: formatBytes(estimatedFreeBytes),
            estimatedFreePercent: `${((estimatedFreeBytes / totalBytes) * 100).toFixed(1)}%`
        };
    } catch (err) {
        return { root: dirPath, error: true };
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

    const trackedDrives = new Set<string>();
    const pendingBytesByRoot = new Map<string, number>();
    const speedBytesByRoot = new Map<string, number>();
    const tableData: any[] = [];

    const newSizeCache: Record<string, number> = {};
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
            } else if (dl.bittorrent?.info?.name) {
                fileName = dl.bittorrent.info.name;
            } else if (fileData.uris && fileData.uris.length > 0) {
                sourceUrl = fileData.uris[0].uri;
                try {
                    const urlObj = new URL(sourceUrl);
                    fileName = path.basename(urlObj.pathname) || urlObj.hostname;
                } catch (e) {
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
            } else {
                // \r returns cursor to start of line, \x1b[K clears the line
                process.stdout.write(`\r\x1b[K\x1b[33m[Analyzing ${i + 1}/${allDownloads.length}]\x1b[0m Fetching remote size for: ${fileName}`);

                const fetchedSize = await fetchSizeFromUrl(sourceUrl);
                if (fetchedSize > 0) {
                    totalBytes = fetchedSize;
                    newSizeCache[sourceUrl] = fetchedSize;
                    cacheModified = true;
                }
            }
        } else {
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
        if (dl.status === 'active') statusFormatted = `\x1b[32m${statusFormatted}\x1b[0m`;
        else if (dl.status === 'waiting' || dl.status === 'paused') statusFormatted = `\x1b[33m${statusFormatted}\x1b[0m`;
        else if (dl.status === 'complete') statusFormatted = `\x1b[36m${statusFormatted}\x1b[0m`;
        else if (dl.status === 'error') statusFormatted = `\x1b[31m${statusFormatted}\x1b[0m`;

        let progressString = `${formatBytes(completedBytes)} / ${formatBytes(totalBytes)}`;
        if (totalBytes === 0 && dl.status !== 'complete') {
            progressString = `\x1b[90mSize Hidden/Failed\x1b[0m`;
        } else if (totalBytes > 0 && dl.totalLength === '0') {
            progressString += ` \x1b[33m(Estim.)\x1b[0m`; // Flag sizes fetched via HTTP HEAD
        }

        let speedStr = '-';
        let etaStr = '-';
        if (dl.status === 'active') {
            speedStr = `${formatBytes(downloadSpeed)}/s`;
            if (downloadSpeed > 0 && totalBytes > completedBytes) {
                etaStr = formatTime(remainingBytes / downloadSpeed);
            } else if (downloadSpeed === 0 && totalBytes > completedBytes) {
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
    console.table(tableData);

    console.log('\n\x1b[1m\x1b[34m--- DRIVE STORAGE ANALYSIS (POST-DOWNLOAD ESTIMATE) ---\x1b[0m');

    const uniqueRoots = new Map<string, any>();
    trackedDrives.forEach((dir) => {
        if (dir !== 'Unknown') {
            const rootDrive = path.parse(path.resolve(dir)).root.toUpperCase();
            if (!uniqueRoots.has(rootDrive)) {
                const pendingForDrive = pendingBytesByRoot.get(rootDrive) || 0;
                const storageInfo = getDriveStorage(dir, pendingForDrive);
                if (!storageInfo.error) uniqueRoots.set(rootDrive, storageInfo);
            }
        }
    });

    const storageTable: any[] = [];
    uniqueRoots.forEach((info) => {
        const rootDrive = info.root;
        const pendingForDrive = pendingBytesByRoot.get(rootDrive) || 0;
        const speedForDrive = speedBytesByRoot.get(rootDrive) || 0;
        let etaStr = '-';
        if (speedForDrive > 0 && pendingForDrive > 0) {
            etaStr = formatTime(pendingForDrive / speedForDrive);
        } else if (speedForDrive === 0 && pendingForDrive > 0) {
            etaStr = '∞';
        }

        storageTable.push({
            'Drive Root': info.root,
            'Total Cap.': info.total,
            'Current Free': info.currentFree,
            'Incoming Data': info.pendingAllocation,
            'Est. Free After DL': info.estimatedFree,
            'Est. Free %': info.estimatedFreePercent,
            'ETA': etaStr
        });
    });

    if (storageTable.length > 0) {
        console.table(storageTable);
    } else {
        console.log('\x1b[90mNo valid disk paths found to analyze.\x1b[0m');
    }

    if (Object.keys(sizeCache).length !== Object.keys(newSizeCache).length || cacheModified) {
        try {
            fs.writeFileSync(CACHE_FILE, JSON.stringify(newSizeCache, null, 2), 'utf8');
        } catch (err) {
            console.error('\x1b[31mFailed to save link sizes cache.\x1b[0m');
        }
    }

    console.log('\x1b[36m========================================================================================\x1b[0m\n');
}

generateReport();
