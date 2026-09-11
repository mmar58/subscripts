import { exec } from 'child_process';
import util from 'util';
import './config.js'; // This loads .env into process.env
const execAsync = util.promisify(exec);
async function runBackup() {
    const serverIp = process.env.SERVER_IP;
    const pemLocation = process.env.PEM_FILE_LOCATION;
    const targetFolder = process.env.TARGET_COPY_FOLDER_LOCATION;
    const destFolder = process.env.DESTINATION_FOLDER_LOCATION;
    const serverUser = process.env.SERVER_USER || 'root';
    const containerName = process.env.TRILIUM_CONTAINER_NAME || 'trilium';
    if (!serverIp || !pemLocation || !targetFolder || !destFolder) {
        console.error("Missing required environment variables (SERVER_IP, PEM_FILE_LOCATION, TARGET_COPY_FOLDER_LOCATION, DESTINATION_FOLDER_LOCATION). Please check your .env file.");
        process.exit(1);
    }
    console.log("==========================================");
    console.log("         Trilium Backup Script            ");
    console.log("==========================================\n");
    try {
        console.log(`[1/3] Stopping Docker container '${containerName}' on ${serverIp}...`);
        await execAsync(`ssh -i "${pemLocation}" -o StrictHostKeyChecking=no ${serverUser}@${serverIp} "docker stop ${containerName}"`);
        console.log("      Container stopped successfully.\n");
        console.log(`[2/3] Copying data from server to '${destFolder}'...`);
        // Using scp. -r for recursive.
        await execAsync(`scp -i "${pemLocation}" -o StrictHostKeyChecking=no -r "${serverUser}@${serverIp}:${targetFolder}" "${destFolder}"`);
        console.log("      Data copied successfully.\n");
        console.log(`[3/3] Restarting Docker container '${containerName}' on ${serverIp}...`);
        await execAsync(`ssh -i "${pemLocation}" -o StrictHostKeyChecking=no ${serverUser}@${serverIp} "docker start ${containerName}"`);
        console.log("      Container restarted successfully.\n");
        console.log("Backup completed successfully!");
    }
    catch (error) {
        console.error("\n[ERROR] An error occurred during the backup process:");
        console.error(error.message);
        if (error.stderr) {
            console.error(error.stderr);
        }
        // Attempt to restart the container if it failed after stopping
        try {
            console.log(`\nAttempting to restart Docker container '${containerName}' due to failure...`);
            await execAsync(`ssh -i "${pemLocation}" -o StrictHostKeyChecking=no ${serverUser}@${serverIp} "docker start ${containerName}"`);
            console.log("Container restarted.");
        }
        catch (restartError) {
            console.error("Failed to restart the container:", restartError.message);
        }
    }
}
runBackup();
