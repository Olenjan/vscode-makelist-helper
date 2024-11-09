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

function addToCMake(cmakePath: string, filePath: string): boolean {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), filePath)
        .replace(/\\/g, '/');

    // Wrap the relative path in quotes
    const quotedRelativePath = `"${relativePath}"`;

    // Determine the target variable (HEADERS, SOURCES, etc.) based on the file extension
    let targetVariable: string = getTargetVariable(filePath);

    // Create a regex to match the correct set block (HEADERS or SOURCES)
    const regex = new RegExp(`set\\(${targetVariable}([\\s\\S]*?)\\)`, 'm');
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
        const newBlock = `set(${targetVariable}${currentBlock}    ${quotedRelativePath}\n)`;
        const newContent = content.replace(regex, newBlock);

        // Write the new content back to the CMakeLists.txt file
        fs.writeFileSync(cmakePath, newContent);
        
        // Return true to indicate the file was successfully added
        return true;
    } else {
        // If no set() block exists for the target variable, create it and add the file
        const newBlock = `set(${targetVariable}\n    ${quotedRelativePath}\n)\n\n`;
        const newContent = newBlock + content;  // Add the new set block at the top of the file

        // Write the new content back to the CMakeLists.txt file
        fs.writeFileSync(cmakePath, newContent);

        // Return true since a new block and the file were added
        return true;
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
            '.h': 'HEADER',
            '.hpp': 'HEADER',
            '.hxx': 'HEADER',
            '.cpp': 'SOURCE',
            '.cxx': 'SOURCE',
            '.cc': 'SOURCE'
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
    

        let disposable = vscode.commands.registerCommand(
            'vscode-makelist-helper.addToCMake',  // Changed this to match package.json
            async (uri: vscode.Uri) => {
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
                    try {
                        let addedAction: string | undefined;

                        const added = addToCMake(selected.description!, filePath);
                        if(added){
                            addedAction = await vscode.window.showInformationMessage(
                                `Added ${path.basename(filePath)} to ${selected.label}`,
                                'Open CMakeLists.txt'
                            );
                        }
                        else{
                            addedAction = await vscode.window.showWarningMessage(
                                `File ${path.basename(filePath)} Already in ${selected.label}`,
                                'Open CMakeLists.txt'
                            );  
                        }
                        // If the user clicked "Open CMakeLists.txt", open the file
                        if (addedAction && addedAction === 'Open CMakeLists.txt') {
                            const document = await vscode.workspace.openTextDocument(selected.description!);
                            await vscode.window.showTextDocument(document);
                        }
                    } catch (error) {
                        vscode.window.showErrorMessage(
                            `Error adding file: ${error}`
                        );
                    }
                }
            }
        );

        context.subscriptions.push(disposable);
    } catch (error) {
        vscode.window.showInformationMessage(`Activation error: ${error}`);
    }
}

export function deactivate() {}