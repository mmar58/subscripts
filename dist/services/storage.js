import fs from 'fs';
import path from 'path';
import { formatBytes } from '../utils/formatters.js';
// Calculate free, total, and estimated disk space
export function getDriveStorage(dirPath, pendingBytes = 0) {
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
    }
    catch (err) {
        return { root: dirPath, error: true };
    }
}
