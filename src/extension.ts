import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';
import { DeleteFileWatcher } from './cmakeFileWatcher';
import { checkDefaultWorkspaceSettings, updateSupportedExtensionsContext } from './helpers';
import {    checkMissingSetBlocks, createMissingSetBlocks,
            handleFileSelection,
            selectCMakeFile, addToCMake, removeFromCMake,
            openCMakeListsIfRequested,
            findCMakeLists, handleDirectorySelection,
            addIncludeDirectory, removeIncludeDirectory} from './cmakeHelpers';
import { CMakeListsLinkProvider } from './documentLinkProvider';

async function refreshDocumentLinks(document: vscode.TextDocument) {
    Logger.log('Refreshing links for:', document.fileName);
    // Close and reopen to clean stale data and reprocess
    const editor = vscode.window.visibleTextEditors.find(ed => ed.document.uri === document.uri);
    if (editor) {
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    }

    const reopenedDocument = await vscode.workspace.openTextDocument(document.uri);
    await vscode.window.showTextDocument(reopenedDocument);

    // Since we reopened document, link provider will auto-evaluate ergonomically
}

function handleFileChange(uri: vscode.Uri) {
    Logger.log("handleFileChange");
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    if (document) {
        refreshDocumentLinks(document);
    }
}

export async function activate(context: vscode.ExtensionContext) {
    try {
        // Initialize workspace settings and context
        await checkDefaultWorkspaceSettings();
        await updateSupportedExtensionsContext();

        // Delete file watcher
        const deleteFileWatcher = new DeleteFileWatcher(context);
        context.subscriptions.push(deleteFileWatcher);

        //CMakeLists.txt link provider
        const linkProvider = vscode.languages.registerDocumentLinkProvider(
            { language: 'cmake', scheme: 'file' }, new CMakeListsLinkProvider()
        );
        context.subscriptions.push(linkProvider);
        

        // Register the command to open files by name
        let openFileByName = vscode.commands.registerCommand('cmakeListsHelper.openFileByName', async (fileName: string, cmakeListPath: string) => {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(cmakeListPath));
        
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found.');
                return;
            }
        
            try {
                const possibleFiles = await vscode.workspace.findFiles(`**/${fileName}`);
        
                if (possibleFiles.length === 0) {
                    vscode.window.showErrorMessage(`File "${fileName}" not found in workspace.`);
                } else if (possibleFiles.length === 1) {
                    const document = await vscode.workspace.openTextDocument(possibleFiles[0]);
                    await vscode.window.showTextDocument(document);
                } else {
                    const chosenFile = await vscode.window.showQuickPick(
                        possibleFiles.map(fileUri => ({
                            label: path.basename(fileUri.fsPath),
                            description: vscode.workspace.asRelativePath(fileUri)
                        })),
                        {
                            placeHolder: `Multiple files named ${fileName} found. Select which one to open:`
                        }
                    );
        
                    if (chosenFile) {
                        Logger.log(`User selected file: ${chosenFile.description}`);
                        const document = await vscode.workspace.openTextDocument(chosenFile.description!);
                        await vscode.window.showTextDocument(document);
                    }
                }
            } catch (error) {
                Logger.error(`Error executing openFileByName: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });

        // Register 'Add to CMakeLists.txt' command
        let addDisposable = vscode.commands.registerCommand('vscode-makelist-helper.addToCMake', async (uri: vscode.Uri, selectedFiles: vscode.Uri[]) => {
            try {
                const fileSelection = await handleFileSelection(uri, selectedFiles);
                if (!fileSelection) {
                    return;
                }
                const { mappedFiles, mapping } = fileSelection;

                const selected = await selectCMakeFile(mappedFiles);
                if (!selected) {
                    return;
                }

                // Check for missing set blocks
                const missingSetBlocks = await checkMissingSetBlocks(selected.description!, mappedFiles, mapping);
                if (missingSetBlocks.size > 0) {
                    const missingBlocks = Array.from(missingSetBlocks).join(', ');
                    const action = await vscode.window.showErrorMessage(
                        `Missing set blocks: ${missingBlocks}. Would you like to create them?`,
                        'Create'
                    );

                    if (!action) {
                        return;
                    }
                    await createMissingSetBlocks(selected.description!, missingSetBlocks);
                }

                let addedFiles = 0;
                let existingFiles = 0;

                for (const file of mappedFiles) {
                    const added = await addToCMake(selected.description!, file.fsPath);
                    if (added) {
                        addedFiles++;
                    } else {
                        existingFiles++;
                    }
                }

                let message = '';
                if (addedFiles > 0) {
                    message += `Added ${addedFiles} file(s). `;
                }
                if (existingFiles > 0) {
                    message += `${existingFiles} file(s) were already present. `;
                }

                await openCMakeListsIfRequested(message, selected.description!);

            } catch (error) {
                Logger.error(`Unexpected error while adding files: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });

        // Register 'Remove from CMakeLists.txt' command
        let removeDisposable = vscode.commands.registerCommand('vscode-makelist-helper.removeFromCMake', async (uri: vscode.Uri, selectedFiles: vscode.Uri[]) => {
            try {
                const fileSelection = await handleFileSelection(uri, selectedFiles);
                if (!fileSelection) {
                    return;
                }
                const { mappedFiles } = fileSelection;

                const selected = await selectCMakeFile(mappedFiles);
                if (!selected) {
                    return;
                }

                // Remove-specific logic
                let removedFiles = 0;
                let notFoundFiles = 0;

                for (const file of mappedFiles) {
                    const removed = await removeFromCMake(selected.description!, file.fsPath);
                    if (removed) {
                        removedFiles++;
                    } else {
                        notFoundFiles++;
                    }
                }

                let message = '';
                if (removedFiles > 0) {
                    message += `Removed ${removedFiles} file(s). `;
                }
                if (notFoundFiles > 0) {
                    message += `${notFoundFiles} file(s) were not found. `;
                }

                await openCMakeListsIfRequested(message, selected.description!);

            } catch (error) {
                Logger.error(`Unexpected error while removing files: ${error instanceof Error ? error.message : 'Unknown error'}`);
            }
        });

        let addIncludeDisposable = vscode.commands.registerCommand(
            'vscode-makelist-helper.addIncludeDirectory',
            async (uri: vscode.Uri) => {
                try {
                    const dirPath = await handleDirectorySelection(uri);
                    if (!dirPath) {
                        return;
                    }
        
                    const cmakeFiles = findCMakeLists(dirPath);
                    if (cmakeFiles.length === 0) {
                        vscode.window.showErrorMessage('No CMakeLists.txt found!');
                        return;
                    }
        
                    const selected = await selectCMakeFile([vscode.Uri.file(dirPath)]);
                    if (!selected) {
                        return;
                    }
        
                    const added = await addIncludeDirectory(selected.description!, dirPath);
                    
                    let message = added 
                        ? `Added include directory successfully.` 
                        : `Directory was already included.`;
        
                    await openCMakeListsIfRequested(message, selected.description!);
        
                } catch (error) {
                    Logger.error(`Unexpected error while adding include directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        );

        let removeIncludeDisposable = vscode.commands.registerCommand(
            'vscode-makelist-helper.removeIncludeDirectory',
            async (uri: vscode.Uri) => {
                try {
                    const dirPath = await handleDirectorySelection(uri);
                    if (!dirPath) {
                        return;
                    }
        
                    const cmakeFiles = findCMakeLists(dirPath);
                    if (cmakeFiles.length === 0) {
                        vscode.window.showErrorMessage('No CMakeLists.txt found!');
                        return;
                    }
        
                    const selected = await selectCMakeFile([vscode.Uri.file(dirPath)]);
                    if (!selected) {
                        return;
                    }
        
                    const removed = await removeIncludeDirectory(selected.description!, dirPath);
                    
                    let message = removed 
                        ? `Removed include directory successfully.` 
                        : `Directory was not found in include_directories().`;
        
                    await openCMakeListsIfRequested(message, selected.description!);
        
                } catch (error) {
                    Logger.error(`Unexpected error while removing include directory: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
        );

        context.subscriptions.push(
            openFileByName,
            addDisposable, removeDisposable,
            addIncludeDisposable, removeIncludeDisposable
        );

    } catch (error) {
        Logger.error(`Activation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function deactivate() {}