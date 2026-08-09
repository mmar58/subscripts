import { exec } from 'child_process';
import os from 'os';

const platform = os.platform();

/**
 * Find the process using a specific port
 * @param port
 */
function findProcessByPort(port: string | number): Promise<{ pid: string, info: string }> {
    return new Promise((resolve, reject) => {
        if (platform === 'win32') {
            // netstat -ano | findstr :<port>
            exec(`netstat -ano | findstr :${port}`, (err, stdout, stderr) => {
                if (err || !stdout) return reject('No process found on port ' + port);
                // Parse output to get PID
                const lines = stdout.trim().split('\n');
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    if (parts.length >= 5) {
                        const pid = parts[4];
                        // Get process info
                        exec(`tasklist /FI "PID eq ${pid}"`, (err2, stdout2) => {
                            if (err2 || !stdout2) return reject('Could not get process info');
                            resolve({ pid, info: stdout2 });
                        });
                        return;
                    }
                }
                reject('No process found on port ' + port);
            });
        } else {
            exec(`lsof -i :${port} -t`, (err, stdout) => {
                if (err || !stdout) return reject('No process found on port ' + port);
                const pid = stdout.trim().split('\n')[0];
                if (!pid) return reject('No process found on port ' + port);
                exec(`ps -p ${pid}`, (err2, stdout2) => {
                    if (err2 || !stdout2) return reject('Could not get process info');
                    resolve({ pid, info: stdout2 });
                });
            });
        }
    });
}

/**
 * Get detailed process information by PID
 * @param pid
 */
function getProcessInfoByPID(pid: string): Promise<{ pid: string, name: string, memory: string, cpu: string, ports: string[], commandLine: string, status: string }> {
    return new Promise(async (resolve, reject) => {
        try {
            if (platform === 'win32') {
                // Get basic process info
                const basicInfo = await new Promise<any>((res, rej) => {
                    exec(`tasklist /FI "PID eq ${pid}" /FO CSV /V`, (err, stdout) => {
                        if (err || !stdout) return rej('Process not found');
                        const lines = stdout.trim().split('\n');
                        if (lines.length < 2) return rej('Process not found');
                        const data = lines[1].split('","').map(s => s.replace(/"/g, ''));
                        res({
                            name: data[0],
                            pid: data[1],
                            memory: data[4],
                            status: data[5],
                            cpu: data[6] || 'N/A',
                            commandLine: data[8] || 'N/A'
                        });
                    });
                });

                // Get ports used by this process
                const ports = await new Promise<string[]>((res) => {
                    exec(`netstat -ano | findstr ${pid}`, (err, stdout) => {
                        if (err || !stdout) return res([]);
                        const portList: string[] = [];
                        const lines = stdout.trim().split('\n');
                        for (const line of lines) {
                            const match = line.match(/:([0-9]+)/);
                            if (match) portList.push(match[1]);
                        }
                        res([...new Set(portList)]); // Remove duplicates
                    });
                });

                resolve({ ...basicInfo, ports });
            } else {
                // Get basic process info on Unix
                const basicInfo = await new Promise<any>((res, rej) => {
                    exec(`ps -p ${pid} -o comm,pmem,stat,pcpu,args`, (err, stdout) => {
                        if (err || !stdout) return rej('Process not found');
                        const lines = stdout.trim().split('\n');
                        if (lines.length < 2) return rej('Process not found');
                        const dataLine = lines[1].trim();
                        const parts = dataLine.split(/\s+/);
                        const name = parts[0];
                        const memory = parts[1] + '%';
                        const status = parts[2];
                        const cpu = parts[3] + '%';
                        const commandLine = parts.slice(4).join(' ');
                        res({
                            name,
                            pid,
                            memory,
                            status,
                            cpu,
                            commandLine
                        });
                    });
                });

                // Get ports used by this process on Unix
                const ports = await new Promise<string[]>((res) => {
                    exec(`lsof -a -p ${pid} -i -P -n`, (err, stdout) => {
                        if (err || !stdout) return res([]);
                        const portList: string[] = [];
                        const lines = stdout.trim().split('\n');
                        for (let i = 1; i < lines.length; i++) {
                            const line = lines[i];
                            const match = line.match(/:([0-9]+)/);
                            if (match) portList.push(match[1]);
                        }
                        res([...new Set(portList)]);
                    });
                });

                resolve({ ...basicInfo, ports });
            }
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Kill a process by PID
 * @param pid
 */
function killProcess(pid: string): Promise<string> {
    return new Promise((resolve, reject) => {
        if (platform === 'win32') {
            exec(`taskkill /PID ${pid} /F`, (err, stdout, stderr) => {
                if (err) return reject('Failed to kill process');
                resolve(stdout);
            });
        } else {
            exec(`kill -9 ${pid}`, (err, stdout, stderr) => {
                if (err) return reject('Failed to kill process');
                resolve(`Process ${pid} terminated.`);
            });
        }
    });
}

// Example usage:
async function main() {
    const args = process.argv.slice(2);
    const pidMode = args.includes('--pid');
    const killMode = args.includes('--kill');
    const value = args.find(arg => !arg.startsWith('--'));
    
    if (!value) {
        console.log('Usage:');
        console.log('  tsx port_controller.ts <port> [--kill]           - Find process by port');
        console.log('  tsx port_controller.ts <pid> --pid [--kill]      - Get process info by PID');
        return;
    }
    
    try {
        if (pidMode) {
            // Get process info by PID
            const processInfo = await getProcessInfoByPID(value);
            console.log('\n=== Process Information ===');
            console.log(`Name: ${processInfo.name}`);
            console.log(`PID: ${processInfo.pid}`);
            console.log(`Memory: ${processInfo.memory}`);
            console.log(`Status: ${processInfo.status}`);
            console.log(`CPU Time: ${processInfo.cpu}`);
            console.log(`Command Line: ${processInfo.commandLine}`);
            console.log(`Ports in use: ${processInfo.ports.length > 0 ? processInfo.ports.join(', ') : 'None'}`);
            
            if (killMode) {
                const result = await killProcess(value);
                console.log('\nProcess terminated:', result);
            }
        } else {
            // Find process by port (original functionality)
            const { pid, info } = await findProcessByPort(value);
            console.log('Process info:\n', info);
            if (killMode) {
                const result = await killProcess(pid);
                console.log('Process terminated:', result);
            }
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

main();
