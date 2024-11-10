import * as vscode from 'vscode';
import * as path from 'path';
import { Logger } from './logger';

export class CMakeListsLinkProvider implements vscode.DocumentLinkProvider {
    private lastDocument: string = '';
    private cachedLinks: vscode.DocumentLink[] = [];
    private debounceTimer: NodeJS.Timeout | undefined;

    async provideDocumentLinks(
        document: vscode.TextDocument, 
        token: vscode.CancellationToken
    ): Promise<vscode.DocumentLink[]> {
        const currentContent = document.getText();
        if (this.lastDocument === currentContent) {
            return this.cachedLinks;
        }

        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        return new Promise((resolve) => {
            this.debounceTimer = setTimeout(async () => {
                if (token.isCancellationRequested) {
                    resolve([]);
                    return;
                }

                const links: vscode.DocumentLink[] = [];
                const text = document.getText();

                const regex = /set\s*\([\w_]+\s+((?:["'][^"']+["']\s*)+)\)/g;
                let match: RegExpExecArray | null;

                while ((match = regex.exec(text)) !== null) {
                    if (token.isCancellationRequested) {
                        resolve([]);
                        return;
                    }

                    const fileSection = match[1];
                    // Modified to capture exact quotes
                    const fileMatches = [...fileSection.matchAll(/["']([^"']+?)["']/g)];

                    for (const fileMatch of fileMatches) {
                        const fileName = fileMatch[1].trim();
                        const fullQuotedString = fileMatch[0]; // This includes the quotes
                        
                        try {
                            const searchPattern = `**/${fileName}`;
                            Logger.log(`Searching for file: ${searchPattern}`);
                            
                            const possibleFiles = await vscode.workspace.findFiles(
                                searchPattern,
                                '**/node_modules/**'
                            );

                            Logger.log(`Found ${possibleFiles.length} matches for ${fileName}`);

                            if (possibleFiles.length === 0) {
                                continue;
                            }

                            // Find the exact position using the quoted string
                            const fullMatch = match[0];
                            const quotedStringIndex = fullMatch.indexOf(fullQuotedString);
                            if (quotedStringIndex === -1){
                                continue;
                            }

                            // Calculate positions based on the quoted string
                            const absoluteStart = match.index + quotedStringIndex + 1; // +1 to skip the opening quote
                            const absoluteEnd = absoluteStart + fileName.length;

                            const linkStart = document.positionAt(absoluteStart);
                            const linkEnd = document.positionAt(absoluteEnd);

                            const linkRange = new vscode.Range(linkStart, linkEnd);
                            const documentLink = new vscode.DocumentLink(linkRange);

                            const uriString = `command:cmakeListsHelper.openFileByName?${encodeURIComponent(JSON.stringify([fileName, document.uri.fsPath]))}`;
                            documentLink.target = vscode.Uri.parse(uriString);

                            links.push(documentLink);
                            Logger.log(`Created link for ${fileName} at range: ${linkRange.start.line}:${linkRange.start.character}-${linkRange.end.line}:${linkRange.end.character}`);
                        } catch (error) {
                            Logger.error(`Error processing file ${fileName}: ${error}`);
                        }
                    }
                }

                this.lastDocument = currentContent;
                this.cachedLinks = links;

                Logger.log(`Total links created: ${links.length}`);
                resolve(links);
            }, 250);
        });
    }
}