
import fs from 'node:fs';
import path from 'node:path';

// ==========================================
// Entry point definitions
// ==========================================

const scriptTypes = {

    client: {
        annotation: 'ClientScript',
        functions: {
            pageInit: {
                description: 'Executes when the page is initialized.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.mode - Page mode'
                ]
            },
            fieldChanged: {
                description: 'Executes when a field value changes.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID',
                    '@param {string} scriptContext.fieldId - Field ID',
                    '@param {number} scriptContext.line - Line number'
                ]
            },
            postSourcing: {
                description: 'Executes after dependent fields are sourced.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID',
                    '@param {string} scriptContext.fieldId - Field ID'
                ]
            },
            sublistChanged: {
                description: 'Executes when a sublist is changed.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID'
                ]
            },
            lineInit: {
                description: 'Executes when a sublist line is initialized.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID'
                ]
            },
            validateField: {
                description: 'Validates a field before accepting a change.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID',
                    '@param {string} scriptContext.fieldId - Field ID',
                    '@param {number} scriptContext.line - Line number',
                    '@returns {boolean} Return true if the field is valid'
                ],
                body: 'return true;'
            },
            validateLine: {
                description: 'Validates a sublist line before committing it.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID',
                    '@returns {boolean} Return true if the line is valid'
                ],
                body: 'return true;'
            },
            validateInsert: {
                description: 'Validates a sublist line insertion.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID',
                    '@returns {boolean} Return true if insertion is allowed'
                ],
                body: 'return true;'
            },
            validateDelete: {
                description: 'Validates a sublist line deletion.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@param {string} scriptContext.sublistId - Sublist ID',
                    '@returns {boolean} Return true if deletion is allowed'
                ],
                body: 'return true;'
            },
            saveRecord: {
                description: 'Executes before the record is saved.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.currentRecord - Current form record',
                    '@returns {boolean} Return true to allow saving'
                ],
                body: 'return true;'
            }
        }
    },

    userevent: {
        annotation: 'UserEventScript',
        functions: {
            beforeLoad: {
                description: 'Executes before the record form is loaded.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.newRecord - New record',
                    '@param {string} scriptContext.type - Operation type',
                    '@param {Form} scriptContext.form - Current form'
                ]
            },
            beforeSubmit: {
                description: 'Executes before the record is submitted.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.newRecord - New record',
                    '@param {Record} scriptContext.oldRecord - Previous record',
                    '@param {string} scriptContext.type - Operation type'
                ]
            },
            afterSubmit: {
                description: 'Executes after the record is submitted.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.newRecord - New record',
                    '@param {Record} scriptContext.oldRecord - Previous record',
                    '@param {string} scriptContext.type - Operation type'
                ]
            }
        }
    },

    suitelet: {
        annotation: 'Suitelet',
        functions: {
            onRequest: {
                description: 'Handles incoming Suitelet requests.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {ServerRequest} scriptContext.request - Incoming request',
                    '@param {ServerResponse} scriptContext.response - Outgoing response'
                ]
            }
        }
    },

    scheduled: {
        annotation: 'ScheduledScript',
        functions: {
            execute: {
                description: 'Executes the scheduled script.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {string} scriptContext.type - Execution type'
                ]
            }
        }
    },

    mapreduce: {
        annotation: 'MapReduceScript',
        functions: {
            getInputData: {
                description: 'Returns the input data for processing.',
                params: [
                    '@param {Object} inputContext'
                ]
            },
            map: {
                description: 'Processes each input key-value pair.',
                params: [
                    '@param {Object} mapContext'
                ]
            },
            reduce: {
                description: 'Processes grouped values by key.',
                params: [
                    '@param {Object} reduceContext'
                ]
            },
            summarize: {
                description: 'Summarizes the execution results.',
                params: [
                    '@param {Object} summaryContext'
                ]
            }
        }
    },

    restlet: {
        annotation: 'Restlet',
        functions: {
            get: {
                description: 'Handles GET requests.',
                params: [
                    '@param {Object} requestParams'
                ],
                returns: '@returns {Object|string} Response data'
            },
            post: {
                description: 'Handles POST requests.',
                params: [
                    '@param {Object} requestBody'
                ],
                returns: '@returns {Object|string} Response data'
            },
            put: {
                description: 'Handles PUT requests.',
                params: [
                    '@param {Object} requestBody'
                ],
                returns: '@returns {Object|string} Response data'
            },
            delete: {
                description: 'Handles DELETE requests.',
                params: [
                    '@param {Object} requestParams'
                ],
                returns: '@returns {Object|string} Response data'
            }
        }
    },

    // ==========================================
    // NEW: Workflow Action Script
    // ==========================================

    workflow: {
        annotation: 'WorkflowActionScript',
        functions: {
            onAction: {
                description: 'Executes when triggered by a workflow action.',
                params: [
                    '@param {Object} scriptContext',
                    '@param {Record} scriptContext.newRecord - Current workflow record',
                    '@param {Record} scriptContext.oldRecord - Previous record',
                    '@returns {string|number|boolean|Date|undefined} Optional workflow return value'
                ]
            }
        }
    }
};


// ==========================================
// Read command-line arguments
// ==========================================

const [name, type, apiVersion] = process.argv.slice(2);

if (!name || !type || !apiVersion) {
    console.error(
        'Usage: npm run create -- <name> <type> <apiVersion>'
    );
    process.exit(1);
}

const selectedType = scriptTypes[type.toLowerCase()];

if (!selectedType) {
    console.error(`Invalid script type: ${type}`);
    console.error(
        `Available types: ${Object.keys(scriptTypes).join(', ')}`
    );
    process.exit(1);
}

if (!['2.0', '2.1'].includes(apiVersion)) {
    console.error('API version must be 2.0 or 2.1');
    process.exit(1);
}

if (!/^[a-zA-Z0-9_-]+(?:\.js)?$/.test(name)) {
    console.error('Invalid filename.');
    process.exit(1);
}


// ==========================================
// Generate JSDoc and entry point functions
// ==========================================

function generateFunction(functionName, config) {

    const docs = [
        '    /**',
        `     * ${config.description}`,
        '     *'
    ];

    for (const param of config.params ?? []) {
        docs.push(`     * ${param}`);
    }

    if (config.returns) {
        docs.push(`     * ${config.returns}`);
    }

    docs.push('     */');

    const body = config.body
        ? `        ${config.body}\n`
        : '';

    const paramName = (
        selectedType.annotation === 'Restlet'
    ) ? (
        ['post', 'put'].includes(functionName)
            ? 'requestBody'
            : 'requestParams'
    ) : 'scriptContext';

    return `${docs.join('\n')}
    function ${functionName}(${paramName}) {
${body}    }`;
}


// ==========================================
// Generate script functions
// ==========================================

const functions = Object.entries(selectedType.functions)
    .map(([functionName, config]) =>
        generateFunction(functionName, config)
    )
    .join('\n\n');


// ==========================================
// Generate entry point exports
// ==========================================

const exports = Object.keys(selectedType.functions)
    .map(name => `        ${name}: ${name}`)
    .join(',\n');


// ==========================================
// Generate SuiteScript file content
// ==========================================

const content = `/**
 * @NApiVersion ${apiVersion}
 * @NScriptType ${selectedType.annotation}
 */
define([], () => {

${functions}

    return {
${exports}
    };
});
`;


// ==========================================
// Create file
// ==========================================

const filename = name.endsWith('.js')
    ? name
    : `${name}.js`;

const directory = path.join(
    process.cwd(),
    'src',
    'FileCabinet',
    'SuiteScripts'
);

fs.mkdirSync(directory, { recursive: true });

const filePath = path.join(directory, filename);

if (fs.existsSync(filePath)) {
    console.error(`File already exists: ${filename}`);
    process.exit(1);
}

fs.writeFileSync(filePath, content, 'utf8');

console.log(`Created: ${filePath}`);
console.log(`Script Type: ${selectedType.annotation}`);
console.log(`API Version: ${apiVersion}`);
console.log('JSDoc documentation generated successfully.');
