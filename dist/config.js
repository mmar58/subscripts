import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// ==========================================
// Environment & Arguments Parsing
// ==========================================
// The original script was in src/, so we preserve checking src/.env just in case,
// but fallback to the project root .env if it exists.
const SRC_ENV_FILE = path.join(__dirname, '.env');
const ROOT_ENV_FILE = path.join(__dirname, '..', '.env');
const envToLoad = fs.existsSync(SRC_ENV_FILE) ? SRC_ENV_FILE : (fs.existsSync(ROOT_ENV_FILE) ? ROOT_ENV_FILE : SRC_ENV_FILE);
if (fs.existsSync(envToLoad)) {
    const envData = fs.readFileSync(envToLoad, 'utf8');
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
let argsRpcUrl = null;
let argsRpcSecret = null;
for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--rpc-url' && argv[i + 1]) {
        argsRpcUrl = argv[++i];
    }
    else if (argv[i].startsWith('--rpc-url=')) {
        argsRpcUrl = argv[i].substring('--rpc-url='.length);
    }
    else if (argv[i] === '--rpc-secret' && argv[i + 1]) {
        argsRpcSecret = argv[++i];
    }
    else if (argv[i].startsWith('--rpc-secret=')) {
        argsRpcSecret = argv[i].substring('--rpc-secret='.length);
    }
}
// ==========================================
// Configuration Exports
// ==========================================
export const RPC_URL = argsRpcUrl || process.env.RPC_URL || 'http://localhost:6800/jsonrpc';
export const RPC_SECRET = argsRpcSecret || process.env.RPC_SECRET || 'mmarWinPc582c';
export const USER_AGENT = 'Transmission/2.94'; // Matches your aria2c config
export const CACHE_FILE = path.join(__dirname, 'link_sizes.json');
