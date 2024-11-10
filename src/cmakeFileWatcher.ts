import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';
import { findCMakeLists, selectCMakeFile, removeFromCMake, openCMakeListsIfRequested } from './cmakeHelpers';

export class CMakeFileWatcher {
    private watcher: vscode.FileSystemWatcher;
    private deletedFiles: Set<string> = new Set();
    private deleteTimer: NodeJS.Timeout | null = null;

    constructor(private context: vscode.ExtensionContext) {
        const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
        const supportedExtensions = config.get<string[]>('supportedExtensions');
        if (!supportedExtensions) {
            throw new Error('No supported extensions configured');
        }

        const pattern = `**/*{${supportedExtensions.join(',')}}`;
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.setupWatcher();

        context.subscriptions.push(
            vscode.workspace.onDidChangeConfiguration(e => {
                if (e.affectsConfiguration('vscode-makelist-helper.supportedExtensions')) {
                    this.updateWatcher();
                }
            })
        );

        context.subscriptions.push(this.watcher);
    }

    private async handleDeletedFiles(uris: vscode.Uri[]) {
        Logger.log('Files deleted:', uris.map(uri => uri.fsPath));
        
        const action = await vscode.window.showInformationMessage(
            `${uris.length} file(s) were deleted. Remove them from CMakeLists.txt?`,
            'Yes',
            'No'
        );

        if (action !== 'Yes') {
            return;
        }

        let selected = await selectCMakeFile(uris);
        let remainingFiles = [...uris];
        let processedFiles = new Set<string>();

        while (selected && remainingFiles.length > 0) {
            let removedFiles = 0;
            let notFoundFiles: vscode.Uri[] = [];

            for (const uri of remainingFiles) {
                const removed = await removeFromCMake(selected.description!, uri.fsPath);
                if (removed) {
                    removedFiles++;
                    processedFiles.add(uri.fsPath);
                } else {
                    notFoundFiles.push(uri);
                }
            }

            let message = '';
            if (removedFiles > 0) {
                message += `Removed ${removedFiles} file(s) from CMakeLists.txt. `;
            }

            if (notFoundFiles.length > 0) {
                const retryAction = await vscode.window.showInformationMessage(
                    `${notFoundFiles.length} file(s) were not found in this CMakeLists.txt. Try another one?`,
                    'Select Another',
                    'Skip'
                );

                if (retryAction === 'Select Another') {
                    selected = await selectCMakeFile(notFoundFiles);
                    remainingFiles = notFoundFiles;
                } else {
                    break;
                }
            } else {
                break;
            }
        }

        if (processedFiles.size > 0) {
            await openCMakeListsIfRequested(
                `Processed ${processedFiles.size} file(s) from CMakeLists.txt`, 
                selected!.description!
            );
        }
    }

    private setupWatcher() {
        this.watcher.onDidDelete(uri => {
            this.deletedFiles.add(uri.fsPath);
            
            if (this.deleteTimer) {
                clearTimeout(this.deleteTimer);
            }

            this.deleteTimer = setTimeout(() => {
                const files = Array.from(this.deletedFiles);
                this.deletedFiles.clear();
                this.handleDeletedFiles(files.map(f => vscode.Uri.file(f)));
            }, 500);
        });
    }

    private updateWatcher() {
        const config = vscode.workspace.getConfiguration('vscode-makelist-helper');
        const supportedExtensions = config.get<string[]>('supportedExtensions');
        if (!supportedExtensions) {
            return;
        }

        const pattern = `**/*{${supportedExtensions.join(',')}}`;
        this.watcher.dispose();
        this.watcher = vscode.workspace.createFileSystemWatcher(pattern);
        this.setupWatcher();
    }

    dispose() {
        if (this.deleteTimer) {
            clearTimeout(this.deleteTimer);
        }
        this.watcher.dispose();
    }
}