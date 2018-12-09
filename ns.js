#!/usr/bin/env node

// this is the console program

var fileCabinet = require("./lib/FileCabinet");
var folderSync = require("./lib/FolderSyncLogic");
var program = require("commander");
var chalk = require('chalk');
var secureConfig = require("./lib/SecureConfigFile");
var fs = require('fs');
var path = require('path');
var _ = require('lodash');
// this is one of the few libs I found that is compatible with the (linux) webstorm terminal
var readlineSync = require('readline-sync');
// custom debugger that logs only if environment variable DEBUG=ns
var debug = require('debug')('ns');

const CONFIG_FILE = 'NetSuiteConfig.js';


// configure the command line interface
program
    .version(require('./package.json').version)
    .option('-u, --upload <file>', "Upload file to NetSuite file cabinet")
    .option('-d, --desc description', "Description for uploaded file")
    .option('-f, --folder [value]',
        "Overrides the internal ID of the target folder for the uploaded file")
    .option('-p, --passphrase [value]', "Provide passphrase for the encrypted settings file")
    .option('-e, --encrypt-config', "encrypts the config file using the NSPW environment variable (must" +
        " be set prior) as passphrase")
    .option('--decrypt-config', "decrypts the config file and displays the plaintext")
    .option('-c, --create-config', "displays a sample generic configuration which you save as " + path.resolve(__dirname, CONFIG_FILE) +
        " then fill out and run the encrypt (-e) command")
    .option('-g, --gen-config', "Contacts NetSuite for config information and generates a config file so you don't " +
        "have to populate the config file entirely by hand")
    .option('--pull-folder <name>', "Pull folder with the specified name form the NetSuite file cabinet")
    .option('--set-file-cabinet-root [path]', "Set the root file cabinet folder. Name is not required. If a path is not specified, the program would use the FileCabinet subfolder of the current folder.")
    .option('-v, --verbose', "Show verbose output")
    .option('--test', "test stuff")
    .on('--help', function () {
        console.log('Examples:');
        console.log();
        console.log('Generate (unencrypted) config file interactively:')
        console.log(chalk.inverse(' ns -g '))
        console.log();
        console.log('Upload a file to the folder set in the config file:')
        console.log(chalk.inverse(' ns -u EC_UserEvent.js '))
        console.log();
        console.log('run in debug mode (linux/osx)')
        console.log(chalk.inverse(' DEBUG=ns; ns -u EC_UserEvent.js '))
    })
    .parse(process.argv);

if (program.decryptConfig) {
    var plaintext = secureConfig.decryptFile(path.resolve(__dirname, CONFIG_FILE) + ".enc", program.passphrase);
    console.log(plaintext);
    process.exit();
}


if (program.encryptConfig) {
    // only just prior to encrypt should the NetSuiteConfig.js file be cleartext
    var out = secureConfig.encryptFile(path.resolve(__dirname, CONFIG_FILE));
    console.log("wrote file:" + out);
    process.exit();
}

if (program.setFileCabinetRoot) {
    
    folderSync.setFileCabinetRoot(__dirname, program.setFileCabinetRoot !== true ? program.setFileCabinetRoot : null);
}

if (program.pullFolder) {
    if (!program.passphrase) {
        console.log(chalk.red("Please provide a passphrase"));
        process.exit();
    }
    folderSync.pullFolder(program.pullFolder, true, __dirname, program.passphrase);
}

if (program.upload) {
    if (program.verbose) {
        console.log("File to upload:", program.upload);
        console.log("File description:", program.desc);
        console.log("Explicit target folder:", program.folder);
    }
    fileCabinet.postFile(program.upload, program.desc, program.folder, __dirname, program.passphrase, function (err, resp) {

        if (err) throw err;

        debug('response from NS cabinet add: %s', JSON.stringify(resp))
		console.log('response from NS cabinet add: ', JSON.stringify(resp));
        var wr = resp.Envelope.Body.addResponse.writeResponse;
        if (wr.status.isSuccess == "true") {
            var successMsg = "File uploaded successfully as internalid " + wr.baseRef.internalId;
            console.log(chalk.green(successMsg));
        }
        else {
            var failMsg = "Problem uploading file" + JSON.stringify(wr);
            console.error(chalk.red(failMsg));
        }
    });
}

if (program.createConfig) {
    createConfig().then(console.log)
}

/**
 * creates a config file string, optionally data binding it
 * @param {{account, email, password, role, webserviceshost, folderid}} params data elements to inject into the template
 * @returns {Promise} promise to return the entire config file string
 */
function createConfig(params) {
    var configTemplate = path.join(__dirname, "lib/NetSuiteConfigTemplate.js");
    return new Promise(function (resolve, reject) {
        fs.readFile(configTemplate, function (err, template) {
            if (err) reject(err);
            else {
                if (params) template = _.template(template)(params);
                resolve(template.toString());
            }
        });
    });
}

if (program.test) {
    fileCabinet.test();
}

if (program.genConfig) {
    if (!program.passphrase) {
        console.log(chalk.red("Please provide a passphrase"));
        process.exit();
    }
    console.log("Generating " + path.resolve(__dirname, CONFIG_FILE) + "...")
    console.log('Enter credentials to select account/role to use..')
    var username = readlineSync.question('Account login email:');
    var password = readlineSync.question('Account login password:');
    console.log('Enter the internal id of the folder to which files will be saved. If you do not set this it will' +
        ' default to zero and you must edit the config file manually to set the folder id value');
    var folder = readlineSync.question('Destination Folder Id:');
    //var isSandbox = readlineSync.keyInYN('Sandbox Account?');

    fileCabinet.discoverConfigInfo(username, encodeURIComponent(password))
        .then(function (result) {
            debug('Received body %s', result.body);
            var accountInfo = promptUserForAccountSelection(JSON.parse(result.body));
            if (!accountInfo) process.exit();
            debug('user selected %s', JSON.stringify(accountInfo, null, "  "));
            return createConfig({
                account: accountInfo.account.internalId,
                email: username,
                password: password,
                role: accountInfo.role.internalId,
                webserviceshost: accountInfo.dataCenterURLs.webservicesDomain,
                folderid: folder || 0
            })
        })
        .then(function (configData) {
            var configFile = path.resolve(__dirname, CONFIG_FILE);
            fs.writeFileSync(configFile, configData);
            console.log('wrote ' + configFile)
            var out = secureConfig.encryptFile(configFile, program.passphrase);
            console.log("wrote " + out);
            console.log("don't forget to delete " + configFile + " after you've tested it's working!")
        })
        .catch(console.error)
}

/**
 * prompts the user to select a NetSuite account+role
 * @param {Array.<{account, role}>} info JSON as returned from NS 'roles' api
 * @returns {{account,role,dataCenterURLs}} the account info object selected
 */
function promptUserForAccountSelection(info) {
    var PAGE_SIZE = 30
    var selectedAccountIndex = -1;

    // create <Account Name> (Role Name) labels for the questions
    var questions = _(info)
        .map(function (r) { return r.account.name + ' (' + r.role.name + ')' + ' [' + r.account.type + ']' })
        .chunk(PAGE_SIZE)
        .forEach(function (q, index) {
        // detect being on 'last page' of results
        var onlastPage = (info.length - (PAGE_SIZE*index)) <= PAGE_SIZE
        var cancelPrompt = onlastPage ? "Cancel" : "Show More...";
        var userInput = readlineSync.keyInSelect(q, 'Which NetSuite Account (Role) to use?', {cancel: cancelPrompt});
        if (userInput === -1) return true // keep iterating if the user didn't select an account
        else{
            console.log('selected', q[userInput])
            // we are on the the nth page of results, so calculate the true index relative to the the entire info array
            selectedAccountIndex = (index * PAGE_SIZE) + userInput
            return false // abort forEach()
        }
    })
    return info[selectedAccountIndex];
}