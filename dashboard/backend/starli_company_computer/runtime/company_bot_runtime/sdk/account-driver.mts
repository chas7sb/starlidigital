import {isAbsolute} from 'node:path';
/** Native Pi account driver. The coordinator sends a single selected credential over private IPC. */
import {isDeepStrictEqual} from 'node:util';

const configuredSDK=process.env.STARLI_COMPANY_PI_SDK;
if(configuredSDK&&(!isAbsolute(configuredSDK)||configuredSDK.split(/[\\/]/).includes('..')))throw Error('COMPANY_SDK_PATH_INVALID');
const SDK=(configuredSDK||'/srv/starlidigital/mcp-workspace/codex-runtime/node_modules/@earendil-works')+'/pi-coding-agent/dist/index.js';

type Selection = {
	provider: string;
	model: string;
	modelsState?: unknown;
	credentials: Record<string, Record<string, any>>;
};
type AccountOptions = {
	selection: Selection;
	signal: AbortSignal;
	authorize: () => Promise<boolean>;
	saveCredential: (value: Record<string, any>) => Promise<boolean>;
	ModelRuntime?: any;
	fetch?: typeof fetch;
};

function validCredential(value: unknown): value is Record<string, any> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const row = value as Record<string, any>;
	if (Buffer.byteLength(JSON.stringify(row)) > 131072) return false;
	// File/profile lookup and custom endpoints lie outside this direct stored-token driver.
	if (row.env && (typeof row.env !== 'object' || Object.keys(row.env).length)) return false;
	if (row.type === 'api_key') return typeof row.key === 'string' && Boolean(row.key.trim());
	return row.type === 'oauth' && typeof row.access === 'string' && Boolean(row.access.trim()) &&
		typeof row.refresh === 'string' && Boolean(row.refresh.trim()) && Number.isFinite(row.expires);
}

export async function accountDriver(options: AccountOptions) {
	const selected = options.selection;
	if (!selected || typeof selected.provider !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,99}$/i.test(selected.provider) ||
		typeof selected.model !== 'string' || !selected.model.trim() || selected.model.length > 255 ||
		!selected.credentials || Object.keys(selected.credentials).length !== 1 ||
		!Object.hasOwn(selected.credentials, selected.provider) || !validCredential(selected.credentials[selected.provider])) {
		throw Error('NATIVE_ACCOUNT_SELECTION_INVALID');
	}
	const {provider, model: modelId} = selected;
	let credential = structuredClone(selected.credentials[provider]);
	const check = async (signal = options.signal) => {
		options.signal.throwIfAborted();
		signal.throwIfAborted();
		if (await options.authorize() !== true) throw Error('NATIVE_ACCOUNT_AUTHORIZATION_DENIED');
		options.signal.throwIfAborted();
		signal.throwIfAborted();
	};
	await check();
	let tail: Promise<unknown> = Promise.resolve();
	const credentials = {
		async read(id: string) { return id === provider ? structuredClone(credential) : undefined; },
		async list() { return [{providerId:provider, type:credential.type}]; },
		async modify(id: string, change: (current: any) => Promise<any>, operation?: {signal?: AbortSignal}) {
			if (id !== provider) throw Error('NATIVE_ACCOUNT_CREDENTIAL_SCOPE_DENIED');
			const operationResult = tail.then(async () => {
				await check(operation?.signal);
				const next = await change(structuredClone(credential));
				if (next !== undefined && !isDeepStrictEqual(next, credential)) {
					if (!validCredential(next) || next.type !== credential.type ||
						await options.saveCredential(next) !== true) throw Error('NATIVE_ACCOUNT_CREDENTIAL_CONFLICT');
					credential = structuredClone(next);
				}
				return structuredClone(credential);
			});
			tail = operationResult.catch(() => {});
			return operationResult;
		},
		async delete() { throw Error('NATIVE_ACCOUNT_CREDENTIAL_SCOPE_DENIED'); }
	};
	const ModelRuntime = options.ModelRuntime ?? (await import(SDK)).ModelRuntime;
	const runtime = await ModelRuntime.create({credentials, modelsPath:null,
		modelsStore:{async read(id:string){return id===provider?selected.modelsState:undefined;},async write(){},async delete(){}},
		allowModelNetwork:false, refreshOnCreate:false, signal:options.signal});
	const model = runtime.getPhysicalModel(provider, modelId);
	if (!model || model.provider !== provider || model.id !== modelId || !model.api ||
		!Array.isArray(model.input) || !model.input.includes('text')) throw Error('NATIVE_ACCOUNT_MODEL_UNSUPPORTED');
	const origin = new URL(model.baseUrl);
	if (origin.protocol !== 'https:' || origin.username || origin.password) throw Error('NATIVE_ACCOUNT_MODEL_ENDPOINT_UNSUPPORTED');
	const rawFetch = options.fetch ?? globalThis.fetch;
	async function streamFn(requestModel: any, context: any, opts: any = {}) {
		if (!isDeepStrictEqual(model, requestModel)) throw Error('NATIVE_ACCOUNT_MODEL_CHANGED');
		const signal = opts.signal ? AbortSignal.any([options.signal, opts.signal]) : options.signal;
		await check(signal);
		const resolution = await runtime.getAuth(model, {signal});
		const expectedKey = credential.type === 'oauth' ? credential.access : credential.key;
		if (!resolution?.auth || typeof resolution.auth.apiKey !== 'string' ||
			resolution.auth.apiKey !== expectedKey ||
			(credential.type === 'oauth' && resolution.source !== 'OAuth') ||
			(resolution.auth.baseUrl && new URL(resolution.auth.baseUrl).origin !== origin.origin)) {
			throw Error('NATIVE_ACCOUNT_PROVIDER_AUTH_UNAVAILABLE');
		}
		await check(signal);
		const scopedFetch: typeof fetch = async (input, init) => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			if (url.origin !== origin.origin || url.username || url.password) throw Error('NATIVE_ACCOUNT_MODEL_ENDPOINT_CHANGED');
			await check(signal);
			return rawFetch(input, {...init, signal: init?.signal ? AbortSignal.any([signal,init.signal]) : signal, redirect:'error'});
		};
		const permitted = {signal, fetch:scopedFetch, transport:'http', maxRetries:0,
			apiKey:resolution.auth.apiKey, headers:resolution.auth.headers, env:{},
			maxTokens: Math.min(8192, Number(model.maxTokens) || 8192)};
		return runtime.streamSimple(model, context, permitted);
	}
	return {model:structuredClone(model), streamFn, receipt:{transport:'PI_NATIVE',provider,model:modelId}};
}

