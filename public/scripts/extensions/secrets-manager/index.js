import { event_types, eventSource, getRequestHeaders, main_api } from '../../../script.js';
import { t } from '../../i18n.js';
import { chat_completion_sources, oai_settings } from '../../openai.js';
import { Popup, POPUP_RESULT } from '../../popup.js';
import { readSecretState, SECRET_KEYS, secret_state, writeSecret } from '../../secrets.js';
import { SlashCommand } from '../../slash-commands/SlashCommand.js';
import { ARGUMENT_TYPE, SlashCommandArgument, SlashCommandNamedArgument } from '../../slash-commands/SlashCommandArgument.js';
import { enumIcons } from '../../slash-commands/SlashCommandCommonEnumsProvider.js';
import { SlashCommandEnumValue } from '../../slash-commands/SlashCommandEnumValue.js';
import { SlashCommandParser } from '../../slash-commands/SlashCommandParser.js';
import { slashCommandReturnHelper } from '../../slash-commands/SlashCommandReturnHelper.js';
import { textgen_types, textgenerationwebui_settings } from '../../textgen-settings.js';
import { isTrueBoolean } from '../../utils.js';

/**
 * @typedef {import('../../slash-commands/SlashCommandExecutor.js').SlashCommandExecutor} Executor
 * @typedef {import('../../slash-commands/SlashCommand.js').NamedArguments | import('../../slash-commands/SlashCommand.js').NamedArgumentsCapture} Args
 * @typedef {import('../../../../src/endpoints/secrets.js').ManagedKeyState} ManagedKeyState
 * @type {import('../../../../src/endpoints/secrets.js').SecretManagerState}
 */
let MANAGER_STATE = {};

const getKeyComment = () => `key-${new Date().toISOString().split('.')[0].replace(/[-:TZ]/g, '')}`;

/**
 * Lookup table for secret keys corresponding to API and type.
 */
const KEY_LOOKUP = [
    { api: 'novel', type: null, key : SECRET_KEYS.NOVEL },
    { api: 'koboldhorde', type: null, key: SECRET_KEYS.HORDE },
    { api: 'openai', type: chat_completion_sources.AI21, key: SECRET_KEYS.AI21 },
    { api: 'openai', type: chat_completion_sources.BLOCKENTROPY, key: SECRET_KEYS.BLOCKENTROPY },
    { api: 'openai', type: chat_completion_sources.COHERE, key: SECRET_KEYS.COHERE },
    { api: 'openai', type: chat_completion_sources.CLAUDE, key: SECRET_KEYS.CLAUDE },
    { api: 'openai', type: chat_completion_sources.CUSTOM, key: SECRET_KEYS.CUSTOM },
    { api: 'openai', type: chat_completion_sources.DEEPSEEK, key: SECRET_KEYS.DEEPSEEK },
    { api: 'openai', type: chat_completion_sources.GROQ, key: SECRET_KEYS.GROQ },
    { api: 'openai', type: chat_completion_sources.MAKERSUITE, key: SECRET_KEYS.MAKERSUITE },
    { api: 'openai', type: chat_completion_sources.MISTRALAI, key: SECRET_KEYS.MISTRALAI },
    { api: 'openai', type: chat_completion_sources.NANOGPT, key: SECRET_KEYS.NANOGPT },
    { api: 'openai', type: chat_completion_sources.OPENAI, key: SECRET_KEYS.OPENAI },
    { api: 'openai', type: chat_completion_sources.OPENROUTER, key: SECRET_KEYS.OPENROUTER },
    { api: 'openai', type: chat_completion_sources.PERPLEXITY, key: SECRET_KEYS.PERPLEXITY },
    { api: 'openai', type: chat_completion_sources.SCALE, key: SECRET_KEYS.SCALE },
    { api: 'openai', type: chat_completion_sources.ZEROONEAI, key: SECRET_KEYS.ZEROONEAI },
    { api: 'textgenerationwebui', type: textgen_types.APHRODITE, key: SECRET_KEYS.APHRODITE },
    { api: 'textgenerationwebui', type: textgen_types.DREAMGEN, key: SECRET_KEYS.DREAMGEN },
    { api: 'textgenerationwebui', type: textgen_types.FEATHERLESS, key: SECRET_KEYS.FEATHERLESS },
    { api: 'textgenerationwebui', type: textgen_types.GENERIC, key: SECRET_KEYS.GENERIC },
    { api: 'textgenerationwebui', type: textgen_types.HUGGINGFACE, key: SECRET_KEYS.HUGGINGFACE },
    { api: 'textgenerationwebui', type: textgen_types.INFERMATICAI, key: SECRET_KEYS.INFERMATICAI },
    { api: 'textgenerationwebui', type: textgen_types.KOBOLDCPP, key: SECRET_KEYS.KOBOLDCPP },
    { api: 'textgenerationwebui', type: textgen_types.LLAMACPP, key: SECRET_KEYS.LLAMACPP },
    { api: 'textgenerationwebui', type: textgen_types.MANCER, key: SECRET_KEYS.MANCER },
    { api: 'textgenerationwebui', type: textgen_types.OOBA, key: SECRET_KEYS.OOBA },
    { api: 'textgenerationwebui', type: textgen_types.OPENROUTER, key: SECRET_KEYS.OPENROUTER },
    { api: 'textgenerationwebui', type: textgen_types.TABBY, key: SECRET_KEYS.TABBY },
    { api: 'textgenerationwebui', type: textgen_types.TOGETHERAI, key: SECRET_KEYS.TOGETHERAI },
    { api: 'textgenerationwebui', type: textgen_types.VLLM, key: SECRET_KEYS.VLLM },
];

function addMissingLookupValues() {
    for (const key of Object.keys(textgen_types)) {
        if (Object.hasOwn(SECRET_KEYS, key) && !KEY_LOOKUP.some(entry => entry.key === SECRET_KEYS[key])) {
            KEY_LOOKUP.push({ api: 'textgenerationwebui', type: textgen_types[key], key: SECRET_KEYS[key] });
        }
    }
    for (const key of Object.keys(chat_completion_sources)) {
        if (Object.hasOwn(SECRET_KEYS, key) && !KEY_LOOKUP.some(entry => entry.key === SECRET_KEYS[key])) {
            KEY_LOOKUP.push({ api: 'openai', type: chat_completion_sources[key], key: SECRET_KEYS[key] });
        }
    }
}

function addEventHandlers() {
    eventSource.on(event_types.SECRET_WRITTEN, async (/** @type {string} */ key) => {
        if (MANAGER_STATE[key]) {
            const result = await migrateSecret(key, `key-${getKeyComment()}`);
            if (!result) {
                return;
            }
            await refreshManagerState();
            toastr.success(t`Secret added to the rotation list.`, t`Secrets Manager`);
        }
    });
}

/**
 * Refreshes the local state of the secrets manager.
 * @returns {Promise<void>} Promise that resolves when the state is refreshed
 */
async function refreshManagerState() {
    try {
        const response = await fetch('/api/secrets/manager/state', {
            method: 'POST',
            headers: getRequestHeaders(),
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch state: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        MANAGER_STATE = data;

        // Refresh the secrets state to update the UI
        await readSecretState();
    } catch (error) {
        console.error('[Secrets Manager] Failed to refresh local state', error);
    }
}

/**
 * Rotates a secret.
 * @param {string} key Secret key
 * @param {string|number} search Search value (index or comment)
 * @returns {Promise<boolean>} True if the secret was rotated successfully
 */
async function rotateSecret(key, search) {
    try {
        const response = await fetch('/api/secrets/manager/rotate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, search }),
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        await refreshManagerState();
        return true;
    } catch (error) {
        console.error('[Secrets Manager] Failed to rotate secret', error);
        return false;
    }
}

/**
 * Appends a new secret to the rotation list.
 * @param {string} key Secret key
 * @param {string} value Secret value
 * @param {string} comment Secret comment
 * @returns  {Promise<boolean>} True if the secret was appended successfully
 */
async function appendSecret(key, value, comment) {
    try {
        const response = await fetch('/api/secrets/manager/append', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, value, comment }),
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        await refreshManagerState();
        return true;
    } catch (error) {
        console.error('[Secrets Manager] Failed to append secret', error);
        return false;
    }
}

/**
 * Removes a secret from the rotation list.
 * @param {string} key Secret key
 * @param {number} index Index of the secret to remove
 * @returns {Promise<boolean>} True if the secret was removed successfully
 */
async function spliceSecret(key, index) {
    try {
        const response = await fetch('/api/secrets/manager/splice', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, index }),
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        await refreshManagerState();
        return true;
    } catch (error) {
        console.error('[Secrets Manager] Failed to splice secret', error);
        return false;
    }
}

/**
 * Checks if a secret is managed by the secrets manager.
 * @param {string} key Secret key
 * @returns {Promise<number>} Index of the secret in the rotation list, or -1 if not managed
 */
async function probeSecret(key) {
    try {
        const response = await fetch('/api/secrets/manager/probe', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key }),
        });

        if (!response.ok) {
            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        return data?.index ?? -1;
    } catch (error) {
        console.error('[Secrets Manager] Failed to probe secret', error);
        return -1;
    }
}

/**
 * Migrates a secret to the secrets manager.
 * @param {string} key Secret key
 * @param {string} comment Secret comment
 * @returns {Promise<boolean>} True if the secret was migrated successfully
 */
async function migrateSecret(key, comment) {
    try {
        const response = await fetch('/api/secrets/manager/migrate', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ key, comment }),
        });

        if (!response.ok) {
            if (response.status === 409) {
                throw new Error(t`Key is already managed by the Secrets Manager.`);
            }

            throw new Error(`Server error: ${response.status} ${response.statusText}`);
        }

        await refreshManagerState();
        return true;
    } catch (error) {
        console.error('[Secrets Manager] Failed to migrate secret', error);
        return false;
    }
}

/**
 * Ensure the key is managed by a secrets manager. If not, prompt to migrate.
 * @param {string} key Secret key
 * @returns {Promise<void>}
 */
async function ensureKeyManaged(key) {
    let isKeyManaged = false;

    if (secret_state[key] && Array.isArray(MANAGER_STATE[key]) && MANAGER_STATE[key].length > 0) {
        const result = await probeSecret(key);
        if (result >= 0) {
            isKeyManaged = true;
        }
    }

    if (isKeyManaged) {
        return;
    }

    const comment = await Popup.show.input(
        t`Key is not managed`,
        t`Would you like to migrate the key to the Secrets Manager? If skipped, the currently saved value will be LOST FOREVER! Enter an optional comment below.`,
        `key-${getKeyComment()}`,
        { okButton: 'Migrate', cancelButton: 'Skip' },
    );

    if (comment === null) {
        return;
    }

    const result = await migrateSecret(key, comment);

    if (!result) {
        toastr.warning(t`Failed to migrate secret. See DevTools for more details.`, t`Secrets Manager`);
        return;
    }

    toastr.success(t`Key migrated successfully.`, t`Secrets Manager`);
}

/**
 * Handles the click event for the clear key button.
 * @param {Event} event Event object
 */
function onKeyClearClick(event) {
    if (!(event.target instanceof HTMLElement)) {
        return;
    }

    const key = event.target.dataset.key;
    if (MANAGER_STATE[key] && MANAGER_STATE[key].length > 0) {
        event.stopPropagation();
        showClearManagedKeyDialog(key);
    }
}

/**
 * Shows a dialog to clear a managed key.
 * @param {string} key Secret key
 * @returns {Promise<void>}
 */
async function showClearManagedKeyDialog(key) {
    const CLEAR_CANCEL = POPUP_RESULT.NEGATIVE;
    const CLEAR_CURRENT = POPUP_RESULT.AFFIRMATIVE;
    const CLEAR_ALL = 2;

    const result = await Popup.show.text(
        t`Current key is managed by the Secrets Manager`,
        t`Would you like to clear just the current secret, or all secrets for this key?`,
        {
            okButton: t`Clear Current`,
            customButtons: [
                {
                    text: t`Clear All`,
                    result: CLEAR_ALL,
                    appendAtEnd: true,
                },
                {
                    text: t`Cancel`,
                    result: CLEAR_CANCEL,
                    appendAtEnd: true,
                },
            ],
        });

    if (result === CLEAR_CANCEL || result === null) {
        return;
    }

    if (result === CLEAR_CURRENT) {
        await spliceSecret(key, MANAGER_STATE[key].findIndex(x => x.selected));
        await rotateSecret(key, '');
    }

    if (result === CLEAR_ALL) {
        await writeSecret(key, '');
        while (MANAGER_STATE[key].length > 0) {
            await spliceSecret(key, 0);
        }
    }
}

function openSecretsManager() {
    alert('NOT IMPLEMENTED YET');
}

function addSlashCommands() {
    const keyProvider = () => Object.values(SECRET_KEYS).map((key) => new SlashCommandEnumValue(key, null, null, enumIcons.key));
    const stateProvider = (/** @type {Executor} */ executor) => {
        const key = executor?.namedArgumentList?.find(arg => arg && arg.name === 'key')?.value ?? '';
        const secretToEnum = (/** @type {ManagedKeyState} */ secret, /** @type {number} */ index) => new SlashCommandEnumValue(String(index), secret.comment, null, enumIcons.secret);
        return key && typeof key === 'string' ? MANAGER_STATE[key].map(secretToEnum) : Object.values(MANAGER_STATE).flatMap(secrets => secrets.map(secretToEnum));
    };

    const keyFromArgs = (/** @type {Args} */ args) => {
        let key = String(args?.key ?? '').trim().toLowerCase();

        if (!key) {
            key = KEY_LOOKUP.find(e => e.api === main_api && (e.type === null || (e.api === 'openai' && e.type === oai_settings.chat_completion_source) || (e.api === 'textgenerationwebui' && e.type === textgenerationwebui_settings.type)))?.key;
            if (!key) {
                throw new Error(t`Secret key not provided or could not be inferred`);
            }
        }

        if (!Object.values(SECRET_KEYS).includes(key)) {
            throw new Error(t`Unknown secret key`);
        }

        return key;
    };

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'secret-add',
        aliases: ['secret-append', 'secret-insert', 'secret-save', 'secret-push'],
        helpString: t`Append a new secret to the rotation list.`,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'key',
                description: t`Secret key`,
                typeList: ARGUMENT_TYPE.STRING,
                enumProvider: keyProvider,
                isRequired: true,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'comment',
                description: t`Comment for the secret`,
                typeList: ARGUMENT_TYPE.STRING,
                isRequired: false,
                acceptsMultiple: false,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: t`Secret value`,
                typeList: [ARGUMENT_TYPE.STRING],
                isRequired: true,
                acceptsMultiple: false,
            }),
        ],
        callback: async (args, value) => {
            const key = keyFromArgs(args);
            const comment = String(args?.comment ?? '').trim();

            if (!value) {
                throw new Error(t`Secret value not provided`);
            }

            if (typeof value !== 'string') {
                throw new Error(t`Secret value must be a string`);
            }

            await ensureKeyManaged(key);
            const result = await appendSecret(key, value, comment);

            if (!result) {
                toastr.warning(t`Failed to append secret. See DevTools for more details.`, t`Secrets Manager`);
            }

            return '';
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'secret-remove',
        aliases: ['secret-delete', 'secret-splice'],
        helpString: t`Remove a secret from the rotation list.`,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'key',
                description: t`Secret key`,
                typeList: ARGUMENT_TYPE.STRING,
                enumProvider: keyProvider,
                isRequired: true,
                acceptsMultiple: false,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: t`Secret index`,
                typeList: [ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                acceptsMultiple: false,
                enumProvider: stateProvider,
            }),
        ],
        callback: async (args, index) => {
            const key = keyFromArgs(args);

            if (isNaN(Number(index))) {
                throw new Error(t`Invalid index`);
            }

            const isSelected = MANAGER_STATE[key]?.[Number(index)]?.selected;
            const result = await spliceSecret(key, Number(index));

            if (isSelected) {
                await rotateSecret(key, '');
            }

            if (!result) {
                toastr.warning(t`Failed to remove secret. See DevTools for more details.`, t`Secrets Manager`);
            }

            return '';
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'secret-current',
        helpString: t`Get the current index of the secret in rotation.`,
        returns: t`index or comment`,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'key',
                description: t`Secret key`,
                typeList: ARGUMENT_TYPE.STRING,
                enumProvider: keyProvider,
                isRequired: true,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'comment',
                description: t`If true, return the comment instead of the index (if available)`,
                typeList: ARGUMENT_TYPE.BOOLEAN,
                isRequired: false,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: t`Suppress notifications`,
                typeList: ARGUMENT_TYPE.BOOLEAN,
                isRequired: false,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'return',
                description: 'The way you want the return value to be provided',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'pipe',
                enumList: slashCommandReturnHelper.enumList({ allowPipe: true, allowChat: false, allowPopup: true, allowTextVersion: false }),
                forceEnum: true,
            }),
        ],
        callback: async (args) => {
            const key = keyFromArgs(args);
            const index = await probeSecret(key);

            if (index < 0) {
                if (!args?.quiet) {
                    toastr.warning(t`Key is not managed by the Secrets Manager.`, t`Secrets Manager`);
                }
                return '';
            }

            let value = String(index);

            if (isTrueBoolean(String(args?.comment))) {
                if (MANAGER_STATE?.[key]?.[index]?.comment) {
                    value = MANAGER_STATE[key][index].comment;
                }
            }

            const returnType = /** @type {any} */ (String(args?.return ?? '') || 'pipe');
            return await slashCommandReturnHelper.doReturn(returnType, value, { objectToStringFunc: String });
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'secret-list',
        returns: t`{ [index]: comment }`,
        helpString: t`List all available secrets for a key. Does not include the actual secret values.`,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'key',
                description: t`Secret key`,
                typeList: ARGUMENT_TYPE.STRING,
                enumProvider: keyProvider,
                isRequired: true,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'return',
                description: 'The way you want the return value to be provided',
                typeList: [ARGUMENT_TYPE.STRING],
                defaultValue: 'pipe',
                enumList: slashCommandReturnHelper.enumList({ allowPipe: true, allowChat: false, allowPopup: true, allowTextVersion: false }),
                forceEnum: true,
            }),
        ],
        callback: async (args) => {
            const key = keyFromArgs(args);
            const state = MANAGER_STATE[key];

            if (!Array.isArray(state)) {
                return JSON.stringify({});
            }

            const list = Object.entries(state).reduce((acc, [index, secret]) => {
                acc[index] = secret.comment;
                return acc;
            }, {});

            const returnType = /** @type {any} */ (String(args?.return ?? '') || 'pipe');
            return await slashCommandReturnHelper.doReturn(returnType, list, { objectToStringFunc: JSON.stringify });
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'secret-migrate',
        helpString: t`Migrate a secret to the Secrets Manager. Optionally provide a comment.`,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'key',
                description: t`Secret key`,
                typeList: ARGUMENT_TYPE.STRING,
                enumProvider: keyProvider,
                isRequired: true,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'comment',
                description: t`Comment for the secret`,
                typeList: ARGUMENT_TYPE.STRING,
                isRequired: false,
                acceptsMultiple: false,
            }),
        ],
        callback: async (args) => {
            const key = keyFromArgs(args);
            const comment = String(args?.comment ?? '').trim();

            const probe = await probeSecret(key);
            if (probe >= 0) {
                toastr.warning(t`Key is already managed by the Secrets Manager.`, t`Secrets Manager`);
                return '';
            }

            const result = await migrateSecret(key, comment);

            if (!result) {
                toastr.warning(t`Failed to migrate secret. See DevTools for more details.`, t`Secrets Manager`);
                return '';
            }

            toastr.success(t`Key migrated successfully.`, t`Secrets Manager`);
            return '';
        },
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'secret-rotate',
        helpString: t`Rotate to a previously saved secret. Search by an index, comment, or leave empty to move to the next secret.`,
        namedArgumentList: [
            SlashCommandNamedArgument.fromProps({
                name: 'key',
                description: t`Secret key`,
                typeList: ARGUMENT_TYPE.STRING,
                enumProvider: keyProvider,
                isRequired: true,
                acceptsMultiple: false,
            }),
            SlashCommandNamedArgument.fromProps({
                name: 'quiet',
                description: t`Suppress notifications`,
                typeList: ARGUMENT_TYPE.BOOLEAN,
                isRequired: false,
                acceptsMultiple: false,
            }),
        ],
        unnamedArgumentList: [
            SlashCommandArgument.fromProps({
                description: t`Search string (index or comment)`,
                typeList: [ARGUMENT_TYPE.STRING, ARGUMENT_TYPE.NUMBER],
                isRequired: true,
                acceptsMultiple: false,
                forceEnum: true,
                enumProvider: stateProvider,
            }),
        ],
        callback: async (args, value) => {
            const key = keyFromArgs(args);
            await ensureKeyManaged(key);

            const search = isNaN(parseInt(String(value))) ? String(value) : Number(value);
            const result = await rotateSecret(key, search);

            if (!result) {
                toastr.warning(t`Failed to rotate secret. See DevTools for more details.`, t`Secrets Manager`);
            }

            if (!args?.quiet) {
                toastr.success(t`Secret rotated successfully.`, t`Secrets Manager`);
            }

            return '';
        },
    }));
}

(async function initExtension() {
    const parentBlock = document.getElementById('main-API-selector-block');
    if (!parentBlock) {
        console.error('[Secrets Manager] Parent block not found');
        return;
    }

    const button = document.createElement('div');
    button.id = 'secrets-manager-button';
    button.classList.add('menu_button', 'menu_button_icon');
    button.addEventListener('click', openSecretsManager);
    const icon = document.createElement('i');
    icon.classList.add('fa-solid', 'fa-key', 'fa-sm');
    const label = document.createElement('span');
    label.textContent = t`Secrets`;
    label.classList.add('alignItemsBaseline');
    button.appendChild(icon);
    button.appendChild(label);
    parentBlock.appendChild(button);

    addSlashCommands();
    addEventHandlers();
    addMissingLookupValues();
    await refreshManagerState();

    document.querySelectorAll('.clear-api-key').forEach((element) => {
        element.addEventListener('click', onKeyClearClick, { capture: true });
    });
})();
