# CMakeLists Helper for VSCode

Welcome to the CMakeLists Helper extension for Visual Studio Code, designed to simplify and enhance your experience managing `CMakeLists.txt` files in C++ projects.

## Features

- **Add Files to CMakeLists.txt:**
  - Easily add `.cpp`, `.hpp`, `.h`, `.hxx`, `.cxx`, and `.cc` files to `CMakeLists.txt`.
  - Automatically detect and create missing `set()` blocks for new files.
  
- **Remove Files from CMakeLists.txt:**
  - Remove entries of deleted or moved files to keep `CMakeLists.txt` clean and updated.

- **File System Watcher:**
  - Detect file deletions and prompt to remove them from `CMakeLists.txt`.
  - Reload `CMakeLists.txt` if it is open upon changes to ensure the editor is in sync with the file system.

- **Customization:**
  - User-configurable mappings for file extensions to CMake variables.
  - Specify which file extensions should be considered for addition or removal through VSCode settings.

## Getting Started

1. **Installation:**
   - Install the extension from the VSCode marketplace.

2. **Initial Setup:**
   - Upon first activation, the extension initializes necessary workspace settings.

3. **Configuration:**
   - Available configuration options located in `settings.json`:
     ```json
     "vscode-makelist-helper.supportedExtensions": [
       ".cpp", ".hpp", ".h", ".hxx", ".cxx", ".cc"
     ],
     "vscode-makelist-helper.setFileMapping": {
       ".h": "HEADERS",
       ".hpp": "HEADERS",
       ".hxx": "HEADERS",
       ".cpp": "SOURCES",
       ".cxx": "SOURCES",
       ".cc": "SOURCES"
     }
     ```

## Usage

- **Add/Remove Files:**
  - Right-click on a file(s) and choose "CMake File Helper" > "Add" | "Remove". Then select CMakeLists.txt in workspace.

- **File Deletion Handling:**
  - When files are deleted, the extension will prompt to remove their references in `CMakeLists.txt`. Then select CMakeLists.txt in workspace.

## License

This extension is licensed under the MIT License.