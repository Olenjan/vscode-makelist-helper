import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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

function addToCMake(cmakePath: string, filePath: string) {
    const content = fs.readFileSync(cmakePath, 'utf8');
    const relativePath = path.relative(path.dirname(cmakePath), filePath)
        .replace(/\\/g, '/');

    let newContent = content;
    if (content.includes('set(SOURCES')) {
        newContent = content.replace(
            /set\(SOURCES([\s\S]*?)\)/,
            `set(SOURCES$1    ${relativePath}\n)`
        );
    } else {
        newContent = content.replace(
            'add_library',
            `set(SOURCES\n    ${relativePath}\n)\n\nadd_library`
        );
    }

    fs.writeFileSync(cmakePath, newContent);
}

export function activate(context: vscode.ExtensionContext) {
    let disposable = vscode.commands.registerCommand(
        'cmake-file-manager.addToCMake',
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
                    addToCMake(selected.description!, filePath);
                    vscode.window.showInformationMessage(
                        `Added ${path.basename(filePath)} to ${selected.label}`
                    );
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Error adding file: ${error}`
                    );
                }
            }
        }
    );

    context.subscriptions.push(disposable);
}

export function deactivate() {}