import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

async function addToCMake(cmakePath: string, filePath: string): Promise<boolean> {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), filePath)
        .replace(/\\/g, '/');

    // Wrap the relative path in quotes
    const quotedRelativePath = `"${relativePath}"`;

    // Determine the target variable (HEADERS, SOURCES, etc.) based on the file extension
    let targetVariable: string = getTargetVariable(filePath);

    // Create a regex to match the correct set block (HEADERS or SOURCES)
    const regex = new RegExp(`set\\(\\s*${targetVariable}(?:[ \\t]|\\r?\\n)([\\s\\S]*?)\\)`, 'm'); //More strict
    //const regex = new RegExp(`set\\(${targetVariable}([\\s\\S]*?)\\)`, 'm'); //More loose
    const match = content.match(regex);

    if (match) {
        const currentBlock = match[1];  // The content inside the current `set(...)` block

        // Normalize the block content by trimming and removing excess whitespace for easier comparison
        const normalizedBlock = currentBlock.split('\n').map(line => line.trim()).filter(line => line.length > 0);

        // Check if the file is already present in the block
        if (normalizedBlock.includes(quotedRelativePath)) {
            // File already exists, return false
            return false;
        }

        // If the file is not already present, append it to the set block
        console.log(`${currentBlock}`);
        const cleanedBlock = normalizedBlock.join('').trim();
        let newBlock;
        if (cleanedBlock.length === 0) {
            // If this is the first entry (truly empty block)
            newBlock = `set(${targetVariable}\n    ${quotedRelativePath}\n)`;
        } else {
            // If there are existing entries, preserve them and append the new one
            const existingContent = normalizedBlock.join('\n    ');
            newBlock = `set(${targetVariable}\n    ${existingContent}\n    ${quotedRelativePath}\n)`;
        }
        const matchedBlock = match[0];  // The entire matched set(...) block
        const newContent = content.replace(matchedBlock, newBlock);
        
        //const newBlock = `set(${targetVariable}${currentBlock}    ${quotedRelativePath}\n)`;
        //const newContent = content.replace(regex, newBlock);

        // Write the new content back to the CMakeLists.txt file
        fs.writeFileSync(cmakePath, newContent);
        
        // Return true to indicate the file was successfully added
        return true;
    } else {
        // If no set() block exists, offer to create a new one
        const action = await vscode.window.showErrorMessage(
            `No set(${targetVariable}) block found in CMakeLists.txt. Would you like to create it?`,
            'Create'
        );

        if (action && action === 'Create') {
            // First, try to find any existing set() blocks
            const setBlockRegex = /set\([^)]+\)/g;
            const projectBlockRegex = /project\([^)]+\)/;
            
            const setMatches = Array.from(content.matchAll(setBlockRegex));
            const projectMatch = content.match(projectBlockRegex);

            if (setMatches.length > 0) {
                // Find the last set() block
                const lastSetMatch = setMatches[setMatches.length - 1];
                const lastSetIndex = lastSetMatch.index! + lastSetMatch[0].length;
                
                // Insert the new block after the last set() block
                const newContent = 
                    content.slice(0, lastSetIndex) + 
                    '\n\n' +
                    `set(${targetVariable}\n    ${quotedRelativePath}\n)` +
                    content.slice(lastSetIndex);
                    
                fs.writeFileSync(cmakePath, newContent);
            } else if (projectMatch) {
                // If no set() blocks found, insert after project()
                const projectIndex = projectMatch.index! + projectMatch[0].length;
                
                const newContent = 
                    content.slice(0, projectIndex) + 
                    '\n\n' +
                    `set(${targetVariable}\n    ${quotedRelativePath}\n)` +
                    content.slice(projectIndex);
                    
                fs.writeFileSync(cmakePath, newContent);
            } else {
                // If no project() block found, add at the top of the file
                const newContent = `set(${targetVariable}\n    ${quotedRelativePath}\n)\n\n${content}`;
                fs.writeFileSync(cmakePath, newContent);
            }

            return true; // Return true since a new block and the file were added
        }

        return false; // Return false if user did not choose to create the block
    }
}



function logWorkspaceSettingsFile(): string | undefined {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (workspaceFolder) {
        return path.join(workspaceFolder.uri.fsPath, '.vscode', 'settings.json');
    } else {
        console.log('No workspace folder open.');
        return undefined;
    }
}

export function activate(context: vscode.ExtensionContext) {
    try {
        // Ensure settings are correctly configured
        const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
        const defaultMapping = {
            '.h': 'HEADERS',
            '.hpp': 'HEADERS',
            '.hxx': 'HEADERS',
            '.cpp': 'SOURCES',
            '.cxx': 'SOURCES',
            '.cc': 'SOURCES'
        };
    
        // Check for existing settings and update if not set
        const existingMapping = config.get('setFileMapping');
        console.log('Existing mapping:', existingMapping);
    
        if (!existingMapping) {
            config.update('setFileMapping', defaultMapping, vscode.ConfigurationTarget.Workspace)
                .then(() => {
                    console.log('Settings updated to:', JSON.stringify(defaultMapping));
                }, (err) => {
                    console.error(`Failed to update settings: ${err}`);
                });
        } else {
            vscode.window.showInformationMessage('File mapping settings already exist in workspace.');
        }
    

        let disposable = vscode.commands.registerCommand('vscode-makelist-helper.addToCMake', async (uri: vscode.Uri) => {
            try {
                const filePath = uri.fsPath;
                const cmakeFiles = findCMakeLists(path.dirname(filePath));
        
                if (cmakeFiles.length === 0) {
                    vscode.window.showErrorMessage('No CMakeLists.txt found!');
                    return;
                }
        
                const selected = await vscode.window.showQuickPick(
                    cmakeFiles.map(file => ({
                        label: path.relative(path.dirname(filePath), file),
                        description: file
                    })),
                    {
                        placeHolder: 'Select CMakeLists.txt'
                    }
                );
        
                if (selected) {
                    let addedAction: string | undefined;
        
                    // Wait for addToCMake to complete
                    const added = await addToCMake(selected.description!, filePath);
        
                    if (added) {
                        // Show success message with option to open CMakeLists.txt
                        addedAction = await vscode.window.showInformationMessage(
                            `Added ${path.basename(filePath)} to ${selected.label}`,
                            'Open CMakeLists.txt'
                        );
                    } else {
                        // Show warning message with option to open CMakeLists.txt
                        addedAction = await vscode.window.showWarningMessage(
                            `File ${path.basename(filePath)} already exists in ${selected.label}`,
                            'Open CMakeLists.txt'
                        );
                    }
        
                    // If the user clicked "Open CMakeLists.txt", open the file
                    if (addedAction === 'Open CMakeLists.txt') {
                        const document = await vscode.workspace.openTextDocument(selected.description!);
                        await vscode.window.showTextDocument(document);
                    }
                }
            } catch (error) {
                vscode.window.showErrorMessage(`Unexpected error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });
        
        context.subscriptions.push(disposable);
    } catch (error) {
        vscode.window.showInformationMessage(`Activation error: ${error}`);
    }
}

export function deactivate() {}