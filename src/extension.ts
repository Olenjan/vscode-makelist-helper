import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

const PREFIX = '[CMakeHelper]';

const nativeConsole = {
    log: Function.prototype.bind.call(console.log, console),
    warn: Function.prototype.bind.call(console.warn, console),
    error: Function.prototype.bind.call(console.error, console)
};

class Logger {
    static log(...args: any[]): void {
        nativeConsole.log(PREFIX, ...args);
    }

    static warn(...args: any[]): void {
        nativeConsole.warn(PREFIX, ...args);
    }

    static error(...args: any[]): void {
        nativeConsole.error(PREFIX, ...args);
    }

    static template(strings: TemplateStringsArray, ...values: any[]): void {
        const message = String.raw({ raw: strings }, ...values);
        nativeConsole.log(PREFIX, message);
    }
}



const SET_BLOCK_REGEX = (targetVariable: string) => 
    new RegExp(`set\\(\\s*${targetVariable}(?:[ \\t]|\\r?\\n)([\\s\\S]*?)\\)`, 'm');


function getTargetVariable(filePath: string): string {
    const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
    const mapping = config.get<{ [key: string]: string }>('setFileMapping');

    if (!mapping) {
        throw new Error(`No mapping found in settings.json`);
    }

    const ext = path.extname(filePath).toLowerCase();
    const targetVariable = mapping[ext];

    if (!targetVariable) {
        throw new Error(`No mapping configured for extension '${ext}' in setFileMapping`);
    }

    return targetVariable;
}

function findCMakeLists(startPath: string): string[] {
    const cmakeFiles: string[] = [];
    let currentDir = startPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(startPath))?.uri.fsPath;
    
    // Stop at workspace folder instead of root
    while (currentDir !== path.dirname(currentDir) && 
           workspaceFolder && currentDir.startsWith(workspaceFolder)) {
        const cmakePath = path.join(currentDir, 'CMakeLists.txt');
        if (fs.existsSync(cmakePath)) {
            cmakeFiles.push(cmakePath);
        }
        currentDir = path.dirname(currentDir);
    }
    
    return cmakeFiles;
}

async function checkMissingSetBlocks(cmakePath: string, files: vscode.Uri[], mapping: { [key: string]: string }): Promise<Set<string>> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const missingSetBlocks = new Set<string>();
    
    files.forEach(file => {
        const ext = path.extname(file.fsPath).toLowerCase();
        const targetVariable = mapping[ext];
        const regex = SET_BLOCK_REGEX(targetVariable);
        if (!content.match(regex)) {
            missingSetBlocks.add(targetVariable);
        }
    });

    return missingSetBlocks;
}

async function createMissingSetBlocks(cmakePath: string, missingBlocks: Set<string>): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    
    // First, try to find any existing set() blocks and project() block
    const setBlockRegex = /set$[^)]+$/g;
    const projectBlockRegex = /project$[^)]+$/;
    
    const setMatches = Array.from(content.matchAll(setBlockRegex));
    const projectMatch = content.match(projectBlockRegex);

    let newContent = content;
    let insertPosition: number;
    let prefix = '\n\n';
    let suffix = '';

    if (setMatches.length > 0) {
        // Insert after the last set() block
        const lastSetMatch = setMatches[setMatches.length - 1];
        insertPosition = lastSetMatch.index! + lastSetMatch[0].length;
    } else if (projectMatch) {
        // Insert after project()
        insertPosition = projectMatch.index! + projectMatch[0].length;
    } else {
        // Insert at the beginning
        insertPosition = 0;
        prefix = '';
        suffix = '\n\n';
    }

    const newBlocks = Array.from(missingBlocks)
        .map(block => `set(${block}\n)\n`)
        .join('\n');

    newContent = 
        newContent.slice(0, insertPosition) + 
        prefix +
        newBlocks +
        suffix +
        newContent.slice(insertPosition);
        
    fs.writeFileSync(cmakePath, newContent);
    return true;
}

async function addToCMake(cmakePath: string, filePath: string): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), filePath)
        .replace(/\\/g, '/');

    const quotedRelativePath = `"${relativePath}"`;
    let targetVariable: string = getTargetVariable(filePath);

    const regex = SET_BLOCK_REGEX(targetVariable);
    const match = content.match(regex);

    // We don't need to throw here because we've already checked for missing blocks
    if (!match) {
        return false;
    }

    const currentBlock = match[1];
    const normalizedBlock = currentBlock.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (normalizedBlock.includes(quotedRelativePath)) {
        return false;
    }

    try {
        const cleanedBlock = normalizedBlock.join('').trim();
        let newBlock;
        if (cleanedBlock.length === 0) {
            newBlock = `set(${targetVariable}\n    ${quotedRelativePath}\n)`;
        } else {
            const existingContent = normalizedBlock.join('\n    ');
            newBlock = `set(${targetVariable}\n    ${existingContent}\n    ${quotedRelativePath}\n)`;
        }
        
        const matchedBlock = match[0];
        const newContent = content.replace(matchedBlock, newBlock);
        fs.writeFileSync(cmakePath, newContent);
        return true;
    } catch (error) {
        throw new Error(`Failed to add ${path.basename(filePath)} to ${targetVariable}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

async function removeFromCMake(cmakePath: string, filePath: string): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), filePath)
        .replace(/\\/g, '/');

    // Wrap the relative path in quotes
    const quotedRelativePath = `"${relativePath}"`;

    // Determine the target variable based on the file extension
    let targetVariable: string = getTargetVariable(filePath);

    // Create a regex to match the correct set block
    const regex = SET_BLOCK_REGEX(targetVariable);
    const match = content.match(regex);

    if (!match) {
        return false;
    }

    const currentBlock = match[1];
    const normalizedBlock = currentBlock.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    // Check if the file is present in the block
    if (!normalizedBlock.includes(quotedRelativePath)) {
        return false;
    }

    // Remove the file from the block
    const updatedBlock = normalizedBlock.filter(line => line !== quotedRelativePath);
    
    let newBlock;
    if (updatedBlock.length === 0) {
        // If block would be empty, create empty set block
        newBlock = `set(${targetVariable}\n)`;
    } else {
        // Recreate block with remaining files
        newBlock = `set(${targetVariable}\n    ${updatedBlock.join('\n    ')}\n)`;
    }

    const matchedBlock = match[0];
    const newContent = content.replace(matchedBlock, newBlock);
    fs.writeFileSync(cmakePath, newContent);
    
    return true;
} 

function checkDefaultWorkspaceSettings(){
    Logger.log('(Check default) Checking default workspace settings');
    const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
    
    // Check both configurations
    const mappingInspection = config.inspect('setFileMapping');
    const extensionsInspection = config.inspect('supportedExtensions');
    
    function updateSetting(key: string, inspection: any | undefined) {
        if (!inspection?.workspaceValue) {
            if (!inspection?.defaultValue) {
                throw new Error(`Default ${key} not found in package.json`);
            }

            Logger.log(`No workspace settings found for ${key}, creating from defaults:`, 
                inspection.defaultValue);

            config.update(key, inspection.defaultValue, vscode.ConfigurationTarget.Workspace)
                .then(() => {
                    Logger.log(`Successfully updated ${key} workspace settings`);
                }, (err) => {
                    console.error(`Failed to update ${key} workspace settings: ${err}`);
                });
        }
    }

    updateSetting("setFileMapping", mappingInspection);
    updateSetting("supportedExtensions", extensionsInspection);

    Logger.log('(Check default) Done checking default workspace settings');
}

function updateSupportedExtensionsContext() {
    Logger.log('(Update extension) Updating context extensions in workspace settings');
    const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
    const supportedExtensions = config.get<string[]>('supportedExtensions');
    if (supportedExtensions) {
        vscode.commands.executeCommand('setContext', 'cmake-helper.supportedExtensions', supportedExtensions);
        Logger.log('Set supported extensions context:', supportedExtensions);
    }
    Logger.log('(Update extension) Done updating context extensions in workspace settings');
}



async function handleFileSelection(uri: vscode.Uri, selectedFiles: vscode.Uri[]) {
    const files = selectedFiles || [uri];
    
    const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
    const mapping = config.get<{ [key: string]: string }>('setFileMapping');
    if (!mapping) {
        throw new Error('No mapping found in settings.json');
    }

    const mappedFiles = files.filter(file => {
        const ext = path.extname(file.fsPath).toLowerCase();
        return mapping[ext] !== undefined;
    });

    if (mappedFiles.length === 0) {
        vscode.window.showWarningMessage('No files with mapped extensions were selected.');
        return null;
    }

    return { mappedFiles, mapping };
}

async function selectCMakeFile(mappedFiles: vscode.Uri[]) {
    const cmakeFiles = findCMakeLists(path.dirname(mappedFiles[0].fsPath));
    if (cmakeFiles.length === 0) {
        vscode.window.showErrorMessage('No CMakeLists.txt found!');
        return null;
    }

    return await vscode.window.showQuickPick(
        cmakeFiles.map(file => ({
            label: path.relative(path.dirname(mappedFiles[0].fsPath), file),
            description: file
        })),
        {
            placeHolder: 'Select CMakeLists.txt'
        }
    );
}

async function openCMakeListsIfRequested(message: string, cmakePath: string) {
    const action = await vscode.window.showInformationMessage(
        message.trim(),
        'Open CMakeLists.txt'
    );

    if (action === 'Open CMakeLists.txt') {
        const document = await vscode.workspace.openTextDocument(cmakePath);
        await vscode.window.showTextDocument(document);
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {

        checkDefaultWorkspaceSettings();
        updateSupportedExtensionsContext();

        //Add to CMakeLists.txt
        let addDisposable = vscode.commands.registerCommand('vscode-makelist-helper.addToCMake', async (uri: vscode.Uri, selectedFiles: vscode.Uri[]) => {
            try {
                const fileSelection = await handleFileSelection(uri, selectedFiles);
                if (!fileSelection){
                    return;
                }
                const { mappedFiles, mapping } = fileSelection;

                const selected = await selectCMakeFile(mappedFiles);
                if (!selected){
                    return;
                }

                // Add-specific logic
                const missingSetBlocks = await checkMissingSetBlocks(selected.description!, mappedFiles, mapping);
                if (missingSetBlocks.size > 0) {
                    const missingBlocks = Array.from(missingSetBlocks).join(', ');
                    const action = await vscode.window.showErrorMessage(
                        `Missing set blocks: ${missingBlocks}. Would you like to create them?`,
                        'Create'
                    );

                    if (!action){
                        return;
                    }
                    await createMissingSetBlocks(selected.description!, missingSetBlocks);
                }

                let addedFiles = 0;
                let existingFiles = 0;

                for (const file of mappedFiles) {
                    const added = await addToCMake(selected.description!, file.fsPath);
                    if (added){
                        addedFiles++;
                    }
                    else{
                        existingFiles++;
                    }
                }

                let message = '';
                if (addedFiles > 0) {
                    message += `Added ${addedFiles} file(s). `;
                }
                if (existingFiles > 0){
                    message += `${existingFiles} file(s) were already present. `;
                }

                await openCMakeListsIfRequested(message, selected.description!);

            } catch (error) {
                vscode.window.showErrorMessage(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });

        //Remove from CMakeLists.txt
        let removeDisposable = vscode.commands.registerCommand('vscode-makelist-helper.removeFromCMake', async (uri: vscode.Uri, selectedFiles: vscode.Uri[]) => {
            try {
                const fileSelection = await handleFileSelection(uri, selectedFiles);
                if (!fileSelection){
                    return;
                }
                const { mappedFiles } = fileSelection;

                const selected = await selectCMakeFile(mappedFiles);
                if (!selected){
                    return;
                }

                // Remove-specific logic
                let removedFiles = 0;
                let notFoundFiles = 0;

                for (const file of mappedFiles) {
                    const removed = await removeFromCMake(selected.description!, file.fsPath);
                    if (removed){
                        removedFiles++;
                    }
                    else{
                        notFoundFiles++;
                    }
                }

                let message = '';
                if (removedFiles > 0){
                    message += `Removed ${removedFiles} file(s). `;
                }
                if (notFoundFiles > 0){
                    message += `${notFoundFiles} file(s) were not found. `;
                }

                await openCMakeListsIfRequested(message, selected.description!);

            } catch (error) {
                vscode.window.showErrorMessage(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });

        context.subscriptions.push(addDisposable);
        context.subscriptions.push(removeDisposable);

    } catch (error) {
        vscode.window.showInformationMessage(`Activation error: ${error}`);
    }
}

export function deactivate() {}