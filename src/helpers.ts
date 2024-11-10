import * as vscode from 'vscode';
import { Logger } from './logger';

export async function checkDefaultWorkspaceSettings(): Promise<void> {
    Logger.log('Checking default workspace settings');
    const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
    
    const settingsToCheck = [
        { key: 'setFileMapping', default: {".h": "HEADERS", ".hpp": "HEADERS", ".cpp": "SOURCES"} },
        { key: 'supportedExtensions', default: [".cpp", ".hpp", ".h"] }
    ];

    for (const setting of settingsToCheck) {
        const inspection = config.inspect(setting.key);
        if (!inspection?.workspaceValue) {
            if (!inspection?.defaultValue) {
                Logger.error(`Default ${setting.key} not found in package.json`);
                continue;
            }
            
            Logger.log(`No workspace settings found for ${setting.key}, creating from defaults:`, setting.default);
            await config.update(setting.key, setting.default, vscode.ConfigurationTarget.Workspace);
        }
    }
}

export async function updateSupportedExtensionsContext(): Promise<void> {
    Logger.log('Updating supported extensions context');
    const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
    const supportedExtensions = config.get<string[]>('supportedExtensions');
    if (supportedExtensions) {
        await vscode.commands.executeCommand('setContext', 'cmake-helper.supportedExtensions', supportedExtensions);
        Logger.log('Set supported extensions context:', supportedExtensions);
    }
}