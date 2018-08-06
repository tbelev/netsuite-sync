var _ = require("lodash");
var folderSyncConfigLogic = require("./FolderSyncConfigLogic");
var fileCabinet = require("./FileCabinet");
var path = require("path"); // file paths
var fs = require("fs"); // IO
var chalk = require('chalk');
var readlineSync = require('readline-sync');

module.exports.pullFolder = function(folderRelPath, isRecursive, configPath, passphrase) {
    folderSyncConfigLogic.init(configPath);

    var absoluteFileCabinetRoot = folderSyncConfigLogic.getAbsoluteFileCabinetRoot();
    var pathElements = getPathElementsForSync(folderRelPath, absoluteFileCabinetRoot);

    var folderId = findStoredNSFolderId(pathElements);
    function fetchFiles() {
        ensurePathExists(pathElements, absoluteFileCabinetRoot);
        console.log("File cabinet folder Id is: " + folderId);
        if (isRecursive) {
            fetchFolderHierarchyWithinFolder(folderId, folderRelPath, configPath, passphrase, function() {
                fetchFilesInFolder(folderId, absoluteFileCabinetRoot, configPath, passphrase, isRecursive);
            });
        } else {
            fetchFilesInFolder(folderId, absoluteFileCabinetRoot, configPath, passphrase, isRecursive);
        }
    }
    
    if (!folderId) {
        fetchFoldersInPath(pathElements, configPath, passphrase, function() {
            folderId = findStoredNSFolderId(pathElements);
            fetchFiles();
        });
    } else {
        console.log(chalk.yellow("*** Found all folder IDs in path cached locally"));
        fetchFiles();
    }
};

module.exports.pushFolder = function(folderRelPath, configPath) {
    // console.log(__filename);
    // console.log(path.resolve(__filename, '..'));
}

module.exports.setFileCabinetRoot = function(configPath, fileCabinetRoot) {
    folderSyncConfigLogic.setFileCabinetRoot(configPath, fileCabinetRoot || 'FileCabinet');
};

function mkdirSync(dirPath) {
    try {
        fs.mkdirSync(dirPath);
    } catch (err) {
        if (err.code !== 'EEXIST') throw err;
    }
}

function ensurePathExists(pathElements, absoluteFileCabinetRoot) {
    // Make sure directory exists locally:
    var currentPath = absoluteFileCabinetRoot;
    mkdirSync(currentPath);
    for (var i = 0; i < pathElements.length; i++) {
        currentPath = path.resolve(currentPath, pathElements[i]);
        mkdirSync(currentPath);
    }
}

function findStoredNSFolderId(pathElements) {
    var config = folderSyncConfigLogic.get();
    if (!config.folders) {
        return null;
    }

    var parentId = null;
    var match;
    for (var i = 0; i < pathElements.length; i++) {
        match = config.folders.find(function (folder) {
            return folder.name.toLowerCase() === pathElements[i].toLowerCase()
                && (folder.parentId == parentId || (!folder.parentId && !parentId));
        });

        if (!match) {
            return null;
        }
        parentId = match.internalId;
    };
    return match.internalId;
}

function fetchFilesInFolder(folderId, fileCabinetPath, configPath, passphrase, isRecursive) {
    // first list the files. Note that this call returns all files in the subfolders as well.
    fileCabinet.listFiles(folderId, configPath, passphrase, function(files) {
        if (files.length < 1) {
            console.log(chalk.yellow("No files found in NetSuite folder with Id " + folderId));
            return;
        }
        console.log(chalk.green("*** Found " + files.length + " files"));
        

        // continue actually downloading the files:
        function fetchNextFile(fileIndex) {
            while (!isRecursive && files[fileIndex].folder.internalId != folderId) {
                fileIndex++;
                if (fileIndex >= files.length) {
                    return; // yes, return, and not just break;
                }
            }

            // Find destination folder to save to. 
            // Alternatively, we could use the folder ID and deduce the path from FolderSyncConfig.json
            var nsFolderPath = files[fileIndex].folder.name.split(' : ');
            nsFolderPath.splice(0, 0, fileCabinetPath);
            var fileDestinationPath = path.resolve.apply(null, nsFolderPath);

            fileCabinet.getFile(files[fileIndex].internalId, configPath, passphrase, function(result) {
                try {
                    var filePath = path.resolve(fileDestinationPath, result.name);
                    var doWriteFile = true;
                    if (fs.existsSync(filePath)) {
                        doWriteFile = readlineSync.keyInYN('File ' + result.name + ' already exists. Overwrite?');
                    }
                    if (doWriteFile) {
                        fs.writeFileSync(filePath, result.content, 'base64');
                    }
                } catch (e) {
                    console.log(e);
                    return callback(false);
                }
                console.log((result ? chalk.green("Fetched: ") : chalk.red("Failed: ")) + files[fileIndex].name);
                
                if (fileIndex < files.length - 1) {
                    fetchNextFile(fileIndex + 1);
                }
            });
        }
        fetchNextFile(0);
    });
}

function fetchFoldersInPath(pathElements, configPath, passphrase, callback) {
    function fetchNextFolder(folderIndex, parentId) {
        fileCabinet.getFolderInfo(pathElements[folderIndex], [parentId], configPath, passphrase, function(result) {
            if (result.length < 1) {
                console.log(chalk.red("Folder not found in NetSuite: " + pathElements[folderIndex] + " (parentId: " + parentId + ")"));
                return;
            }
            console.log(chalk.green("*** Found folder: ") + JSON.stringify(result[0], null, 4));
            folderSyncConfigLogic.storeFolderInfo(result[0]);

            // continue with next folder:
            if (folderIndex < pathElements.length - 1) {
                fetchNextFolder(folderIndex + 1, result[0].internalId);
            } else {
                // Done fetching folders. Do what's next
                callback();
            }
        });
    }

    fetchNextFolder(0, 0);
}

function fetchFolderHierarchyWithinFolder(folderId, destinationPath, configPath, passphrase, callback) {
    function fetchChildFoldersForParentIds(parentIds, savePath) {
        fileCabinet.getFolderInfo(null, parentIds, configPath, passphrase, function(results) {
            console.log(chalk.green("*** Found folders: ") + JSON.stringify(results, null, 4));
            results.forEach(function (result) {
                folderSyncConfigLogic.storeFolderInfo(result);
                var pathToCreate = result.parentId
                    ? path.resolve(folderSyncConfigLogic.getLocalPath(result.parentId), result.name)
                    : path.resolve(folderSyncConfigLogic.getAbsoluteFileCabinetRoot(), result.name);
                mkdirSync(pathToCreate);
            });

            // continue with next level of folder:
            if (results.length > 0) {
                fetchChildFoldersForParentIds(_.map(results, 'internalId'));
            } else {
                // Done fetching folders. Do what's next
                callback();
            }
        });
    }

    fetchChildFoldersForParentIds([folderId], destinationPath);
}

function getPathElementsForSync(folderRelPath, absoluteFileCabinetRoot) {
    var pathElements = [];
    var currentPath = path.resolve(folderRelPath);
    do {
        pathElements.push(path.parse(currentPath).base);
        currentPath = path.dirname(currentPath);
    } while (path.dirname(currentPath) !== currentPath && currentPath !== absoluteFileCabinetRoot);
    // console.log(currentPath);
    // console.log(absoluteFileCabinetRoot);
    if (currentPath != absoluteFileCabinetRoot) {
        console.error(chalk.red("The path specified with the --pull-folder argument should be a subfolder of the File Cabinet root path, "
            + "which is currently set to " + absoluteFileCabinetRoot + " as found in the " + folderSyncConfigLogic.SYNC_CONFIG_FILE + " file."));
    }

    pathElements = _.reverse(pathElements);
    console.log("Path Elements: " + JSON.stringify(pathElements));
    return pathElements;
}
