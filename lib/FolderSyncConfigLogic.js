var path = require("path"); // file paths
var fs = require("fs"); // IO
var chalk = require('chalk');

var SYNC_CONFIG_FILE = "FolderSyncConfig.json";
module.exports.SYNC_CONFIG_FILE = SYNC_CONFIG_FILE;

var config;
var configFile;

module.exports.init = function(configPath) {
    configFile = configPath ? path.resolve(configPath, SYNC_CONFIG_FILE) : SYNC_CONFIG_FILE;
    var error;
    try {
        config = read(configFile);
    } catch (e) {
        error = true;
    }

    if (error || !config.fileCabinetRoot) {
        console.error(chalk.red("Error: No Rood File Cabinet Folder was configured. Please configure it using the --set-file-cabinet-root option."));
        process.exit();
    }
};

module.exports.get = function() {
    // Deep clone to prevent tampering:
    return JSON.parse(JSON.stringify(config));
};

module.exports.getAbsoluteFileCabinetRoot = function() {
    if (!config.fileCabinetRoot) {
        console.error(chalk.red("Error: Root file cabinet path not setup."));
        return;
    }

    return path.resolve(config.fileCabinetRoot);
};

module.exports.setFileCabinetRoot = function(configPath, fileCabinetRoot) {
    if (!fileCabinetRoot) {
        console.error(chalk.red("Error: Root file cabinet path not specified."));
        return;
    }

    configFile = configPath ? path.resolve(configPath, SYNC_CONFIG_FILE) : SYNC_CONFIG_FILE;
    try {
        config = read(configFile);
    } catch (e) {
        config = {};
    }
    
    if (config.fileCabinetRoot != fileCabinetRoot) {
        config.fileCabinetRoot = fileCabinetRoot;
        save();
    }
}

module.exports.storeFolderInfo = function(folderInfo) {
    if (!config.folders) {
        config.folders = [];
    }
    
    var exists = false;
    config.folders.forEach(function (item) {
        if (item.internalId == folderInfo.internalId) {
            item.name = folderInfo.name;
            item.parentId = folderInfo.parentId;
            exists = true;
        }
    });

    if (!exists) {
        config.folders.push(folderInfo);
    }
    save();
};

module.exports.getLocalPath = function(folderId) {
    var pathElements = [];
    while (true) {
        var match = config.folders.find(function (item) {
            return item.internalId === folderId;
        });
        if (match) {
            pathElements.splice(0, 0, match.name);
            folderId = match.parentId
        } else {
            break;
        }
    }
    if (pathElements.length > 0) {
        var fileCabinetRoot = module.exports.getAbsoluteFileCabinetRoot();
        pathElements.splice(0, 0, fileCabinetRoot);
        return path.resolve.apply(null, pathElements)
    } else {
        return null;
    }
};

function read(configFile) {
    var configText = fs.readFileSync(configFile, "utf-8");
    return JSON.parse(configText);
}

function save() {
    fs.writeFileSync(configFile, JSON.stringify(config, null, 4), "utf-8");
}

// return {
//     init: init,
//     get: get,
//     setFileCabinetRoot: setFileCabinetRoot,
//     storeFolderInfo: storeFolderInfo
// };
//}();

