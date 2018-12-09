
/**
 * Provides access to netsuite file cabinet. This is intended to allow commandline driven suitescript file sync
 * so that we don't have to do it manually through the UI anymore.
 * NetSuite WSDL is at https://webservices.netsuite.com/wsdl/v2014_2_0/netsuite.wsdl as of this writing
 */

var _ = require("lodash");
var xml2js = require('xml2js');
var xmlparser = new xml2js.Parser({
    tagNameProcessors: [xml2js.processors.stripPrefix], // remove namespace prefixes foo:bar => bar
    attrNameProcessors: [xml2js.processors.stripPrefix],
    explicitArray: false, // only create arrays if needed
    mergeAttrs: true // put attributes on the parent element rather than a child object ($)
});
var debug = require('debug')('ns');
var request = require("request"); // basic HTTP
var path = require("path"); // file paths
var fs = require("fs"); // IO
var readlineSync = require('readline-sync');

var secureConfig = require("./SecureConfigFile");
var nsConf;
// the netsuite config defines the 'nsConf' variable and this program assumes the config file is already encrypted
function init(configPath, passphrase) { nsConf = eval(secureConfig.decryptFile(path.resolve(configPath, "NetSuiteConfig.js.enc"), passphrase)); }

//if (!nsConf) throw Error("nsConf variable does not exist - likely a problem with your NetSuiteConfig encrypted" +
//" config file because that is where the [nsConf] variable should be defined!");

/**
 * Creates SOAP xml using the common soap header and the given body template + body data
 * @param bodyTemplateFilename XML template to merge with data
 * @param data data to merge into the template
 * @returns string of entire soap message
 */
function makeSoapMsg(bodyTemplateFilename, data) {
    debug('making SOAP')
    // header is fixed
    var headerTempl = path.resolve(__dirname, "SoapHeader.xml");
    var headerContent = fs.readFileSync(headerTempl, {encoding: 'utf-8'});

    var bodyContent = fs.readFileSync(path.resolve(__dirname, bodyTemplateFilename), {encoding: 'utf-8'});

    // create a request with the header and our soap body based on the global netsuite config
    var requestData = _.extend(nsConf, {soapBody: _.template(bodyContent)(data)});
    debug('requestData', requestData)
    return _.template(headerContent)(requestData);
}

/**
 * Invokes the web service and returns the response
 * @param soapaction
 * @param soapRequest
 * @param callback callback function called with 3 arguments
 * error, response, body
 */
function invokeWebService(soapaction, soapRequest, callback) {
    var opts = {
        uri: nsConf.endpoint,
        headers: {SOAPAction: soapaction},
        body: soapRequest
    };
    //console.log(opts);
    request.post(opts, callback);
}

/**
 * Converts a docFileCab:File XML response from NS to a local file
 * @param xml entire SOAP envelope response from NS
 */
function saveFileCabinetResponseXMLtoFile(xml) {
    var record = xml.Envelope.Body.getResponse.readResponse.record;
    fs.writeFileSync(record.name, record.content, {endcoding: 'base64'});
    console.log(JSON.stringify(record));
}


function hasFault(soapxml) {
    if (soapxml.Envelope.Body.Fault) {
        return JSON.stringify(soapxml.Envelope.Body.Fault);
    }
}

/**
 * Checks a soap message for NetSuite's standard status success/failure response
 * @param soapxml the soap xml message
 * @returns boolean true if the message indicates success status
 */
function ensureReadResponseStatusSuccess(soapxml, callback) {
    var fault = hasFault(soapxml);
    if (fault) {
        console.log (fault);
        return false;
    }
    else return soapxml.Envelope.Body.getResponse.readResponse.status.isSuccess === "true";
}

/**
 * Checks a soap message for NetSuite's standard status success/failure response
 * @param soapxml the soap xml message
 * @returns boolean true if the message indicates success status
 */
function ensureSearchResultStatusSuccess(soapxml, callback) {
    var fault = hasFault(soapxml);
    if (fault) {
        console.log (fault);
        return false;
    }
    else return soapxml.Envelope.Body.searchResponse.searchResult.status.isSuccess === "true";
}

function get(recordType, internalId, callback) {
    var nsRequest = makeSoapMsg("getTemplate.xml", {internalId: internalId, type: recordType});
    invokeWebService("get", nsRequest, callback);
}
/**
 * GET record operation
 * @param recordType netsuite record type
 * @param internalId internal id of the desired record
 * @param callback gets (error, http response, body) as parameters
 */
module.exports.get = function (recordType, internalId, configPath, passphrase, callback) {
    init(configPath, passphrase);
    get(recordType, internalId, callback);
};

/**
 * Retrieves the given file by internal id and saves it
 * @param internalid
 * @param callback
 */
module.exports.getFile = function (internalid, configPath, passphrase, callback) {
    init(configPath, passphrase);
    get("file", internalid, function (err, response, xmlbody) {
        // save the body as a file in the current directory
        xmlparser.parseString(xmlbody, function (err, result) {
            if (!err) {
                if (!ensureReadResponseStatusSuccess(result)) {
                    console.log("Unexpected Error Response:");
                    console.log(JSON.stringify(result).substr(0, 5000));
                    return callback(false);
                }

                var record = result.Envelope.Body.getResponse.readResponse.record;
                
                //console.log(JSON.stringify(record));
                return callback(record);
            } else {
                console.log("Request Failed:");
                console.log(err);
                return callback(false);
            }
        })
    });
};


/**
 * Gets the config info it can from netsuite's 'rest' api (e.g. service uri, ns account#, etc.)
 * @param {string} email user's email for login
 * @param {string} password password used for login
 * @returns {Promise} where rejection will receive (error,response) else will receive (err,response, body)
 * from NS
 */
module.exports.discoverConfigInfo = function (email, password) {
    var targetHost = 'https://rest.netsuite.com';
    var options = {
        url: targetHost + '/rest/roles',
        headers: {
            'Authorization': 'NLAuth nlauth_email=' + email + ',nlauth_signature=' + password
        }
    };

    return new Promise( function(resolve,reject){
        request.get(options, function(error,response,body) {
            if (!error && response.statusCode == 200) resolve({response:response,body:body});
            else reject({ error:error, response: response});
        });
    });
};

module.exports.test = function () {
    console.log(__dirname);
};

module.exports.search = function () {
    init();
    var nsRequest = makeSoapMsg("getTemplate.xml", {internalId: internalid, type: recordType});
    invokeWebService("get", nsRequest, callback);
};

// ======= basic folder search
function folderSearch (callback) {
    var nsRequest = makeSoapMsg("folderSearchTemplate.xml", {fileCabinetRootId: 0});
    console.log(nsRequest);
    invokeWebService("search", nsRequest, callback);
};

module.exports.getFolders = function (configPath, passphrase, callback) {
    init(configPath, passphrase);
    folderSearch(function (err, response, xmlbody) {
        // create a json from the search results
        xmlparser.parseString(xmlbody, function (err, result) {
            if (!err) {
                if (!ensureSearchResultStatusSuccess(result)) return callback(result);

                var results = result.Envelope.Body.searchResponse.searchResult;
                
                console.log(JSON.stringify(results).substr(0, 10000));
            }
            if (callback)  return callback(err, result);
        });
    });
};

// ============= single folder search by name & parentId
function folderInfo(folderName, parentIds, callback) {
    var nsRequest = makeSoapMsg("folderSearchTemplate.xml", {
        folderName: folderName,
        parentIds: parentIds || [],
        isTopLevel: !parentIds || !parentIds[0]
    });
    //console.log(nsRequest);
    invokeWebService("search", nsRequest, callback);
}
/**
 * Gets the config info it can from netsuite's 'rest' api (e.g. service uri, ns account#, etc.)
 * @param {string} folderName the name of the folder to search for in the NS FileCabinet or null if not specifying.
 * @param {string} parentId the internal ID of the parent folder. Provide 0, if looking for top-level folder.
 * @param {string} configPath path to the config files
 * @param {string} passphrase passphrase to use to decrypt the config file with the NS credentials
 * @returns {Promise} where rejection will receive (error,response) else will receive (err,response, body)
 * from NS
 */
module.exports.getFolderInfo = function (folderName, parentIds, configPath, passphrase, callback) {
    init(configPath, passphrase);
    folderInfo(folderName, parentIds, function (err, response, xmlbody) {
        // create a json from the search results
        xmlparser.parseString(xmlbody, function (err, result) {
            if (!err) {

                if (!ensureSearchResultStatusSuccess(result)) {
                    console.log("Unexpected Error Response:");
                    console.log(JSON.stringify(result).substr(0, 5000));
                    return;
                }
                var results = result.Envelope.Body.searchResponse.searchResult.recordList;

                //console.log(JSON.stringify(result).substr(0, 5000));
                var prunedResults = [];
                if (results && results.record) {
                    if (!(results.record instanceof Array)) {
                        results.record = [results.record];
                    }
                    results.record.forEach(function (item) {
                        prunedResults.push({
                            internalId: item.internalId,
                            name: item.name,
                            parentId: item.parent ? item.parent.internalId : undefined
                        });
                    });
                }
                if (callback)  return callback(prunedResults);
            } else {
                console.log("Request Failed:");
                console.log(err);
            }
        });
    });
};

// ============= file search by folderId
function fileSearch(folderId, callback) {
    var nsRequest = makeSoapMsg("fileSearchTemplate.xml", {folderId: folderId});
    //console.log(nsRequest);
    invokeWebService("search", nsRequest, callback);
}
/**
 * Gets the config info it can from netsuite's 'rest' api (e.g. service uri, ns account#, etc.)
 * @param {string} folderId the internal ID of the parent folder.
 * @param {string} configPath path to the config files
 * @param {string} passphrase passphrase to use to decrypt the config file with the NS credentials
 * @returns {Promise} where rejection will receive (error,response) else will receive (err,response, body)
 * from NS
 */
module.exports.listFiles = function (folderId, configPath, passphrase, callback) {
    init(configPath, passphrase);
    if (!folderId) {
        console.log("You need to provide a valid folderId in order to list the files");
    }
    fileSearch(folderId, function (err, response, xmlbody) {
        // create a json from the search results
        xmlparser.parseString(xmlbody, function (err, result) {
            if (!err) {

                if (!ensureSearchResultStatusSuccess(result)) {
                    console.log("Unexpected Error Response:");
                    console.log(JSON.stringify(result).substr(0, 5000));
                    return;
                }
                var results = result.Envelope.Body.searchResponse.searchResult.recordList;

                var resultsAsString = JSON.stringify(results);
                //console.log(resultsAsString.substr(0, 5000));
                var prunedResults = [];
                if (results && results.record) {
                    if (!(results.record instanceof Array)) {
                        results.record = [results.record];
                    }
                    results.record.forEach(function (item) {
                        prunedResults.push({
                            internalId: item.internalId,
                            name: item.name,
                            folder: item.folder
                        });
                    });
                }
                if (callback)  return callback(prunedResults);
            }
            else {
                console.log("Request Failed:");
                console.log(err);
            }
        });
    });
};

/**
 * Sends a file to NetSuite to the configured folder, overwriting if the file exists.
 * @param filename local file (e.g. EC_UserEventFoo.js)
 * @param [description] optional description of the file, shown in netsuite ui
 * @param folder
 * @param {function(err,resp,body)} callback function to receive the error or successful response from NS
 */
module.exports.postFile = function (filename, description, folder, configPath, passphrase, callback) {
    init(configPath, passphrase);
    add(filename, description, folder, function (err, resp, body) {
        // save the body as a file in the current directory
        xmlparser.parseString(body, function (err, result) {
            return callback(err,result);
        });
    });
};

/**
 * Adds ta file to the file cabinet. This is a low level call.
 * @param filename full path to the file you want to send
 * @param description file description you'd like to have appear in NS
 * @param folder internalid of the folder in which to place the file
 * @param callback receives results of the web service call
 */
function add(filename, description, folder, callback) {
    var content = fs.readFileSync(filename, {encoding: 'base64'});
    var nsRequest = makeSoapMsg("addFileTemplate.xml", {
        folderid: folder || nsConf.folderid,
        filename:path.basename(filename),
        content:content,
        description:description
    });

    // console.log(nsRequest);
    invokeWebService("add", nsRequest, callback);
};
