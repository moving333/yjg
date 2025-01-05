import fs from 'node:fs';
import path from 'node:path';

import express from 'express';
import { sync as writeFileAtomicSync } from 'write-file-atomic';
import { getConfigValue } from '../util.js';
import { jsonParser } from '../express-common.js';

const allowKeysExposure = !!getConfigValue('allowKeysExposure', false);

export const SECRETS_FILE = 'secrets.json';
export const SECRET_KEYS = {
    HORDE: 'api_key_horde',
    MANCER: 'api_key_mancer',
    VLLM: 'api_key_vllm',
    APHRODITE: 'api_key_aphrodite',
    TABBY: 'api_key_tabby',
    OPENAI: 'api_key_openai',
    NOVEL: 'api_key_novel',
    CLAUDE: 'api_key_claude',
    DEEPL: 'deepl',
    LIBRE: 'libre',
    LIBRE_URL: 'libre_url',
    LINGVA_URL: 'lingva_url',
    OPENROUTER: 'api_key_openrouter',
    SCALE: 'api_key_scale',
    AI21: 'api_key_ai21',
    SCALE_COOKIE: 'scale_cookie',
    ONERING_URL: 'oneringtranslator_url',
    DEEPLX_URL: 'deeplx_url',
    MAKERSUITE: 'api_key_makersuite',
    SERPAPI: 'api_key_serpapi',
    TOGETHERAI: 'api_key_togetherai',
    MISTRALAI: 'api_key_mistralai',
    CUSTOM: 'api_key_custom',
    OOBA: 'api_key_ooba',
    INFERMATICAI: 'api_key_infermaticai',
    DREAMGEN: 'api_key_dreamgen',
    NOMICAI: 'api_key_nomicai',
    KOBOLDCPP: 'api_key_koboldcpp',
    LLAMACPP: 'api_key_llamacpp',
    COHERE: 'api_key_cohere',
    PERPLEXITY: 'api_key_perplexity',
    GROQ: 'api_key_groq',
    AZURE_TTS: 'api_key_azure_tts',
    FEATHERLESS: 'api_key_featherless',
    ZEROONEAI: 'api_key_01ai',
    HUGGINGFACE: 'api_key_huggingface',
    STABILITY: 'api_key_stability',
    BLOCKENTROPY: 'api_key_blockentropy',
    CUSTOM_OPENAI_TTS: 'api_key_custom_openai_tts',
    TAVILY: 'api_key_tavily',
    NANOGPT: 'api_key_nanogpt',
    BFL: 'api_key_bfl',
    GENERIC: 'api_key_generic',
    DEEPSEEK: 'api_key_deepseek',
};

const INITIAL_STATE = /** @type {SecretState} */ (Object.freeze({ managed: {} }));

// These are the keys that are safe to expose, even if allowKeysExposure is false
const EXPORTABLE_KEYS = [
    SECRET_KEYS.LIBRE_URL,
    SECRET_KEYS.LINGVA_URL,
    SECRET_KEYS.ONERING_URL,
    SECRET_KEYS.DEEPLX_URL,
];

/**
 * @typedef {object} ManagedKey
 * @property {string} comment Key comment
 * @property {string} value Key value
 * @typedef {Record<string, string> & { managed: Record<string, ManagedKey[]> }} SecretState
 * @typedef {Omit<ManagedKey & { selected: boolean }, 'value'>} ManagedKeyState
 * @typedef {Record<string, ManagedKeyState[]>} SecretManagerState
 */

/**
 * Reads the secret state from the secrets file.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {SecretState} Secret state
 */
function getSecretState(directories) {
    const filePath = path.join(directories.root, SECRETS_FILE);

    if (!fs.existsSync(filePath)) {
        return structuredClone(INITIAL_STATE);
    }

    const fileContents = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(fileContents);
}

/**
 * Writes the secret state to the secrets file.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {SecretState} state New secret state
 */
function updateSecretState(directories, state) {
    const filePath = path.join(directories.root, SECRETS_FILE);
    writeFileAtomicSync(filePath, JSON.stringify(state, null, 4), 'utf-8');
}

/**
 * Writes a secret to the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Secret key
 * @param {string} value Secret value
 */
export function writeSecret(directories, key, value) {
    const secrets = getSecretState(directories);
    secrets[key] = value;
    updateSecretState(directories, secrets);
}

/**
 * Deletes a secret from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Secret key
 */
export function deleteSecret(directories, key) {
    const secrets = getSecretState(directories);
    delete secrets[key];
    updateSecretState(directories, secrets);
}

/**
 * Reads a secret from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Secret key
 * @returns {string} Secret value
 */
export function readSecret(directories, key) {
    const secrets = getSecretState(directories);
    return secrets[key];
}

/**
 * Rotates a secret in the secrets file.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Key to rotate
 * @param {string|number} [searchValue] Search value (comment or index)
 */
export function rotateManagedSecret(directories, key, searchValue) {
    const secrets = getSecretState(directories);

    if (!secrets.managed) {
        return;
    }

    if (!Array.isArray(secrets.managed[key]) || secrets.managed[key].length === 0) {
        return;
    }

    let keyData = null;
    const managed = secrets.managed[key];
    if (typeof searchValue === 'number' && searchValue >= 0 && searchValue < managed.length) {
        keyData = managed[searchValue];
    }
    if (typeof searchValue === 'string' && searchValue.trim().length > 0) {
        keyData = managed.find(key => String(key.comment).trim().toLowerCase() === searchValue.trim().toLowerCase());
    }
    if (!keyData) {
        const currentSecret = readSecret(directories, key);
        const currentIndex = managed.findIndex((key) => key.value === currentSecret);
        keyData = managed[currentIndex + 1] || managed[0];
    }

    writeSecret(directories, key, keyData.value);
}

/**
 * Appends a managed key to the secrets file.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Key identifier
 * @param {string} comment Comment for the key
 * @param {string} value Value for the key
 */
export function appendManagedKey(directories, key, comment, value) {
    const secrets = getSecretState(directories);
    if (!secrets.managed) {
        secrets.managed = {};
    }
    if (!secrets.managed[key]) {
        secrets.managed[key] = [];
    }
    secrets.managed[key].push({ comment, value });
    updateSecretState(directories, secrets);
}

/**
 * Removes a managed key from the secrets.
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @param {string} key Key identifier
 * @param {number} index Index of the key to remove
 * @returns
 */
export function spliceManagedKey(directories, key, index) {
    const secrets = getSecretState(directories);

    if (!secrets.managed || !Array.isArray(secrets.managed[key])) {
        return;
    }

    if (index < 0 || index >= secrets.managed[key].length) {
        return;
    }

    secrets.managed[key].splice(index, 1);
    updateSecretState(directories, secrets);
}

/**
 * Checks if the saved key value is managed by the secret manager.
 * @param {import('../users.js').UserDirectoryList} directories
 * @param {string} key Key identifier
 * @returns {{result: boolean, index: number}} Probe result
 */
function probeManagedKey(directories, key) {
    const secrets = getSecretState(directories);

    if (!secrets.managed || !Array.isArray(secrets.managed[key])) {
        return { result: false, index: -1 };
    }

    const currentSecret = readSecret(directories, key);
    const index = secrets.managed[key].findIndex((key) => key.value === currentSecret);
    return { result: index !== -1, index };
}

/**
 * Reads the managed secrets state.
 * @param {import('../users.js').UserDirectoryList} directories
 * @returns {SecretManagerState} Secret state
 */
function readManagedSecretsState(directories) {
    const secrets = getSecretState(directories);
    const state = /** @type {SecretManagerState} */ ({});

    if (!secrets.managed) {
        return state;
    }

    for (const key of Object.keys(secrets.managed)) {
        state[key] = [];
        for (const secret of secrets.managed[key]) {
            const selected = secrets[key] === secret.value;
            state[key].push({ comment: secret.comment, selected: selected });
        }
    }

    return state;
}

/**
 * Reads the secret state from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {object} Secret state
 */
export function readSecretState(directories) {
    const filePath = path.join(directories.root, SECRETS_FILE);

    if (!fs.existsSync(filePath)) {
        return {};
    }

    const fileContents = fs.readFileSync(filePath, 'utf8');
    const secrets = JSON.parse(fileContents);
    const state = {};

    for (const key of Object.values(SECRET_KEYS)) {
        if (key === 'managed') {
            continue;
        }
        state[key] = !!secrets[key]; // convert to boolean
    }

    return state;
}

/**
 * Reads all secrets from the secrets file
 * @param {import('../users.js').UserDirectoryList} directories User directories
 * @returns {Record<string, string> | undefined} Secrets
 */
export function getAllSecrets(directories) {
    const filePath = path.join(directories.root, SECRETS_FILE);

    if (!fs.existsSync(filePath)) {
        console.log('Secrets file does not exist');
        return undefined;
    }

    const fileContents = fs.readFileSync(filePath, 'utf8');
    const secrets = JSON.parse(fileContents);
    return secrets;
}

export const router = express.Router();

router.post('/write', jsonParser, (request, response) => {
    const key = request.body.key;
    const value = request.body.value;

    writeSecret(request.user.directories, key, value);
    return response.sendStatus(204);
});

router.post('/read', jsonParser, (request, response) => {
    try {
        const state = readSecretState(request.user.directories);
        return response.send(state);
    } catch (error) {
        console.error(error);
        return response.send({});
    }
});

router.post('/view', jsonParser, async (request, response) => {
    const allowKeysExposure = getConfigValue('allowKeysExposure', false);

    if (!allowKeysExposure) {
        console.error('secrets.json could not be viewed unless the value of allowKeysExposure in config.yaml is set to true');
        return response.sendStatus(403);
    }

    try {
        const secrets = getAllSecrets(request.user.directories);

        if (!secrets) {
            return response.sendStatus(404);
        }

        return response.send(secrets);
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

router.post('/find', jsonParser, (request, response) => {
    const key = request.body.key;

    if (!allowKeysExposure && !EXPORTABLE_KEYS.includes(key)) {
        console.error('Cannot fetch secrets unless allowKeysExposure in config.yaml is set to true');
        return response.sendStatus(403);
    }

    try {
        const secret = readSecret(request.user.directories, key);

        if (!secret) {
            return response.sendStatus(404);
        }

        return response.send({ value: secret });
    } catch (error) {
        console.error(error);
        return response.sendStatus(500);
    }
});

// Secret Manager handlers
const manager = express.Router();
router.use('/manager', manager);

manager.post('/state', jsonParser, (request, response) => {
    const state = readManagedSecretsState(request.user.directories);
    return response.send(state);
});

manager.post('/rotate', jsonParser, (request, response) => {
    const key = request.body.key;
    const searchValue = request.body.search;

    rotateManagedSecret(request.user.directories, key, searchValue);
    return response.sendStatus(204);
});

manager.post('/append', jsonParser, (request, response) => {
    const key = request.body.key;
    const comment = request.body.comment;
    const value = request.body.value;

    appendManagedKey(request.user.directories, key, comment, value);
    return response.sendStatus(204);
});

manager.post('/splice', jsonParser, (request, response) => {
    const key = request.body.key;
    const index = request.body.index;

    spliceManagedKey(request.user.directories, key, index);
    return response.sendStatus(204);
});

manager.post('/probe', jsonParser, (request, response) => {
    const key = request.body.key;
    const result = probeManagedKey(request.user.directories, key);
    return response.send(result);
});

manager.post('/migrate', jsonParser, (request, response) => {
    const key = request.body.key;
    const comment = request.body.comment;

    const probeResult = probeManagedKey(request.user.directories, key);
    if (probeResult.result) {
        return response.sendStatus(409);
    }
    const currentSecret = readSecret(request.user.directories, key);
    appendManagedKey(request.user.directories, key, comment, currentSecret);
    return response.sendStatus(204);
});
