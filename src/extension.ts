import * as vscode from 'vscode';
import { Logger } from './logger';
import { CMakeFileWatcher } from './cmakeFileWatcher';
import { checkDefaultWorkspaceSettings, updateSupportedExtensionsContext } from './helpers';
import {    checkMissingSetBlocks, createMissingSetBlocks,
            handleFileSelection,
            selectCMakeFile, addToCMake, removeFromCMake,
            openCMakeListsIfRequested } from './cmakeHelpers';

export async function activate(context: vscode.ExtensionContext) {
    try {
        // Initialize workspace settings and context
        await checkDefaultWorkspaceSettings();
        await updateSupportedExtensionsContext();

        // Initialize file watcher
        const fileWatcher = new CMakeFileWatcher(context);
        context.subscriptions.push(fileWatcher);

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

        context.subscriptions.push(addDisposable, removeDisposable);

    } catch (error) {
        Logger.error(`Activation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export function deactivate() {}