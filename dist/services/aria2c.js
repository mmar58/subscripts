import { RPC_URL, RPC_SECRET } from '../config.js';
// Make JSON-RPC request to aria2c
export async function callAria2(method, params = []) {
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
        if (!response.ok)
            throw new Error(`HTTP Error: ${response.status}`);
        const data = await response.json();
        if (data.error)
            throw new Error(`RPC Error: ${data.error.message}`);
        return data.result;
    }
    catch (err) {
        console.error(`\x1b[31mFailed to connect to aria2c RPC at ${RPC_URL}\x1b[0m`);
        process.exit(1);
    }
}
