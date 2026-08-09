// Helper to format raw bytes into human-readable strings
export function formatBytes(bytes: number | string): string {
    bytes = Number(bytes);
    if (isNaN(bytes) || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper to format time (in seconds) into a readable string
export function formatTime(seconds: number): string {
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

// Helper to print a table without the index column
export function printTable(data: any[]) {
    if (!data || data.length === 0) return;
    const keys = Object.keys(data[0]);
    const colWidths = keys.map(k => k.length);
    
    for (const row of data) {
        keys.forEach((k, i) => {
            const val = String(row[k] ?? '');
            const visibleLen = val.replace(/\x1b\[[0-9;]*m/g, '').length;
            if (visibleLen > colWidths[i]) colWidths[i] = visibleLen;
        });
    }

    const topBorder = '┌─' + keys.map((_, i) => '─'.repeat(colWidths[i])).join('─┬─') + '─┐';
    const bottomBorder = '└─' + keys.map((_, i) => '─'.repeat(colWidths[i])).join('─┴─') + '─┘';
    const midBorder = '├─' + keys.map((_, i) => '─'.repeat(colWidths[i])).join('─┼─') + '─┤';

    console.log(topBorder);
    const header = '│ ' + keys.map((k, i) => k.padEnd(colWidths[i])).join(' │ ') + ' │';
    console.log(header);
    console.log(midBorder);

    for (const row of data) {
        const line = '│ ' + keys.map((k, i) => {
            const val = String(row[k] ?? '');
            const visibleLen = val.replace(/\x1b\[[0-9;]*m/g, '').length;
            const pad = ' '.repeat(Math.max(0, colWidths[i] - visibleLen));
            return val + pad;
        }).join(' │ ') + ' │';
        console.log(line);
    }
    console.log(bottomBorder);
}
