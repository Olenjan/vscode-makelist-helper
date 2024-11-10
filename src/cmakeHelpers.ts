import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from './logger';

function createSetRegex(targetVariable: string): RegExp {
    return new RegExp(`set\\(\\s*${targetVariable}(?:[ \\t]|\\r?\\n)([\\s\\S]*?)\\)`, 'm');
}

function createIncludeDirectoriesRegex(): RegExp {
    return new RegExp(`include_directories\\(([\\s\\S]*?)\\)`, 'm');
}

export async function addIncludeDirectory(cmakePath: string, dirPath: string): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), dirPath).replace(/\\/g, '/');
    const includeEntry = `\${CMAKE_CURRENT_SOURCE_DIR}/${relativePath}`;

    const regex = createIncludeDirectoriesRegex();
    const match = content.match(regex);

    if (!match) {
        // If no include_directories block exists, create one after project() or at the beginning
        const projectMatch = content.match(/project\([^)]+\)/);
        let newContent;
        
        if (projectMatch) {
            const insertPosition = projectMatch.index! + projectMatch[0].length;
            newContent = 
                content.slice(0, insertPosition) +
                `\n\ninclude_directories(\n    ${includeEntry}\n)` +
                content.slice(insertPosition);
        } else {
            newContent = `include_directories(\n    ${includeEntry}\n)\n\n${content}`;
        }
        
        fs.writeFileSync(cmakePath, newContent);
        return true;
    }

    const currentBlock = match[1];
    const normalizedBlock = currentBlock.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (normalizedBlock.includes(includeEntry)) {
        return false;
    }

    try {
        const cleanedBlock = normalizedBlock.join('').trim();
        let newBlock;
        if (cleanedBlock.length === 0) {
            newBlock = `include_directories(\n    ${includeEntry}\n)`;
        } else {
            const existingContent = normalizedBlock.join('\n    ');
            newBlock = `include_directories(\n    ${existingContent}\n    ${includeEntry}\n)`;
        }
        
        const matchedBlock = match[0];
        const newContent = content.replace(matchedBlock, newBlock);
        fs.writeFileSync(cmakePath, newContent);
        return true;
    } catch (error) {
        throw new Error(`Failed to add include directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function removeIncludeDirectory(cmakePath: string, dirPath: string): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), dirPath).replace(/\\/g, '/');
    const includeEntry = `\${CMAKE_CURRENT_SOURCE_DIR}/${relativePath}`;

    const regex = createIncludeDirectoriesRegex();
    const match = content.match(regex);

    if (!match) {
        return false;
    }

    const currentBlock = match[1];
    const normalizedBlock = currentBlock.split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0);

    if (!normalizedBlock.includes(includeEntry)) {
        return false;
    }

    try {
        const updatedBlock = normalizedBlock.filter(line => line !== includeEntry);
        
        let newBlock;
        if (updatedBlock.length === 0) {
            newBlock = `include_directories(\n)`;
        } else {
            newBlock = `include_directories(\n    ${updatedBlock.join('\n    ')}\n)`;
        }

        const matchedBlock = match[0];
        const newContent = content.replace(matchedBlock, newBlock);
        fs.writeFileSync(cmakePath, newContent);
        return true;
    } catch (error) {
        throw new Error(`Failed to remove include directory ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// Add this function to handle directory selection
export async function handleDirectorySelection(uri: vscode.Uri): Promise<string | undefined> {
    const stats = await vscode.workspace.fs.stat(uri);
    if (stats.type === vscode.FileType.Directory) {
        return uri.fsPath;
    }
    
    // If a file is selected, use its parent directory
    return path.dirname(uri.fsPath);
}

export async function checkMissingSetBlocks(cmakePath: string, files: vscode.Uri[], mapping: { [key: string]: string }): Promise<Set<string>> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const missingSetBlocks = new Set<string>();
    
    files.forEach(file => {
        const ext = path.extname(file.fsPath).toLowerCase();
        const targetVariable = mapping[ext];
        const regex = createSetRegex(targetVariable);
        if (!content.match(regex)) {
            missingSetBlocks.add(targetVariable);
        }
    });

    return missingSetBlocks;
}

export async function createMissingSetBlocks(cmakePath: string, missingBlocks: Set<string>): Promise<void> {
    const content = fs.readFileSync(cmakePath, 'utf8');

    // First, look for an appropriate insertion point
    const setBlockRegex = /set\([^)]+\)/g;
    const projectBlockRegex = /project\([^)]+\)/;

    const setMatches = Array.from(content.matchAll(setBlockRegex));
    const projectMatch = content.match(projectBlockRegex);

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

    // Create the new set blocks
    const newBlocks = Array.from(missingBlocks)
        .map(block => `set(${block}\n)\n`)
        .join('\n');

    const newContent = 
        content.slice(0, insertPosition) +
        prefix +
        newBlocks +
        suffix +
        content.slice(insertPosition);

    fs.writeFileSync(cmakePath, newContent);
}

export function findCMakeLists(startPath: string): string[] {
    const cmakeFiles: string[] = [];
    let currentDir = startPath;
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(startPath))?.uri.fsPath;

    while (currentDir !== path.dirname(currentDir) && workspaceFolder && currentDir.startsWith(workspaceFolder)) {
        const cmakePath = path.join(currentDir, 'CMakeLists.txt');
        if (fs.existsSync(cmakePath)) {
            cmakeFiles.push(cmakePath);
        }
        currentDir = path.dirname(currentDir);
    }

    return cmakeFiles;
}

export async function handleFileSelection(
    uri: vscode.Uri, 
    selectedFiles: vscode.Uri[]
): Promise<{ mappedFiles: vscode.Uri[]; mapping: { [key: string]: string } } | null> {
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

export async function selectCMakeFile(mappedFiles: vscode.Uri[]): Promise<vscode.QuickPickItem | null> {
    const cmakeFiles = findCMakeLists(path.dirname(mappedFiles[0].fsPath));
    if (cmakeFiles.length === 0) {
        vscode.window.showErrorMessage('No CMakeLists.txt found!');
        return null;
    }

    const items: vscode.QuickPickItem[] = cmakeFiles.map(file => ({
        label: path.relative(path.dirname(mappedFiles[0].fsPath), file),
        description: file
    }));

    const selectedItem = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select CMakeLists.txt'
    });

    return selectedItem || null;
}

export async function addToCMake(cmakePath: string, filePath: string): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), filePath).replace(/\\/g, '/');
    const quotedRelativePath = `"${relativePath}"`;
    let targetVariable: string = getTargetVariable(filePath);

    const regex = createSetRegex(targetVariable);
    const match = content.match(regex);

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

export async function removeFromCMake(cmakePath: string, filePath: string): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), filePath).replace(/\\/g, '/');
    const quotedRelativePath = `"${relativePath}"`;
    const targetVariable = getTargetVariable(filePath);

    const regex = createSetRegex(targetVariable);
    const match = content.match(regex);

    if (!match) {
        return false;
    }

    const currentBlock = match[1];
    const normalizedBlock = currentBlock.split('\n').map(line => line.trim()).filter(line => line.length > 0);

    if (!normalizedBlock.includes(quotedRelativePath)) {
        return false;
    }

    const updatedBlock = normalizedBlock.filter(line => line !== quotedRelativePath);

    let newBlock;
    if (updatedBlock.length === 0) {
        newBlock = `set(${targetVariable}\n)`;
    } else {
        newBlock = `set(${targetVariable}\n    ${updatedBlock.join('\n    ')}\n)`;
    }

    const matchedBlock = match[0];
    const newContent = content.replace(matchedBlock, newBlock);
    fs.writeFileSync(cmakePath, newContent);

    return true;
}

export async function openCMakeListsIfRequested(message: string, cmakePath: string): Promise<void> {
    const action = await vscode.window.showInformationMessage(
        message.trim(),
        'Open CMakeLists.txt'
    );

    if (action === 'Open CMakeLists.txt') {
        for (const editor of vscode.window.visibleTextEditors) {
            if (editor.document.uri.fsPath === cmakePath) {
                await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
                break;
            }
        }
        
        const document = await vscode.workspace.openTextDocument(cmakePath);
        await vscode.window.showTextDocument(document);
    }
}

// Utility function used here
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