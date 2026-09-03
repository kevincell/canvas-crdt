// Minimal util polyfill for browser - provides debuglog and inspect
// Used by simple-peer and other Node.js libraries

// debuglog - returns a no-op function in browser
export function debuglog(section: string) {
  if (typeof console !== 'undefined' && console.debug) {
    return (...args: any[]) => console.debug(`[${section}]`, ...args);
  }
  return () => {};
}

// inspect - simple implementation
export function inspect(obj: any, options?: any): string {
  const seen = new WeakSet();
  
  function format(value: any, depth: number): string {
    if (depth > (options?.depth ?? 2)) return '[Object]';
    
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'string') return `'${value}'`;
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'symbol' || typeof value === 'bigint') {
      return String(value);
    }
    if (typeof value === 'function') return '[Function]';
    
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    
    if (Array.isArray(value)) {
      if (value.length === 0) return '[]';
      const items = value.map(v => format(v, depth + 1)).join(', ');
      return `[ ${items} ]`;
    }
    
    if (value instanceof Error) return value.stack ?? value.toString();
    if (value instanceof Date) return value.toISOString();
    if (value instanceof RegExp) return value.toString();
    if (value instanceof Map) {
      const items = Array.from(value.entries()).map(([k, v]) => `${format(k, depth + 1)} => ${format(v, depth + 1)}`).join(', ');
      return `Map { ${items} }`;
    }
    if (value instanceof Set) {
      const items = Array.from(value).map(v => format(v, depth + 1)).join(', ');
      return `Set { ${items} }`;
    }
    
    // Plain object
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    const items = keys.map(k => `${k}: ${format(value[k], depth + 1)}`).join(', ');
    return `{ ${items} }`;
  }
  
  return format(obj, 0);
}

// Export other util functions as no-ops or minimal implementations
export const format = (format: string, ...args: any[]): string => {
  return format.replace(/%[sdj%]/g, (match) => {
    if (match === '%%') return '%';
    const arg = args.shift();
    if (match === '%s') return String(arg);
    if (match === '%d' || match === '%i') return Number(arg).toString();
    if (match === '%j') return JSON.stringify(arg);
    return match;
  });
};

export const isArray = Array.isArray;
export const isBoolean = (v: any) => typeof v === 'boolean';
export const isNull = (v: any) => v === null;
export const isNullOrUndefined = (v: any) => v === null || v === undefined;
export const isNumber = (v: any) => typeof v === 'number';
export const isString = (v: any) => typeof v === 'string';
export const isSymbol = (v: any) => typeof v === 'symbol';
export const isUndefined = (v: any) => v === undefined;
export const isRegExp = (v: any) => v instanceof RegExp;
export const isObject = (v: any) => typeof v === 'object' && v !== null;
export const isDate = (v: any) => v instanceof Date;
export const isError = (v: any) => v instanceof Error;
export const isFunction = (v: any) => typeof v === 'function';
export const isPrimitive = (v: any) => v === null || typeof v !== 'object';
export const isBuffer = () => false;
export const isArrayBuffer = (v: any) => v instanceof ArrayBuffer;
export const isDataView = (v: any) => v instanceof DataView;
export const isMap = (v: any) => v instanceof Map;
export const isSet = (v: any) => v instanceof Set;
export const isWeakMap = (v: any) => v instanceof WeakMap;
export const isWeakSet = (v: any) => v instanceof WeakSet;
export const isPromise = (v: any) => v && typeof v.then === 'function';
export const isGeneratorFunction = () => false;
export const isGeneratorObject = () => false;
export const isAsyncFunction = () => false;
export const isExternal = () => false;

// deprecate - no-op in browser
export function deprecate(fn: Function, msg: string): Function {
  let warned = false;
  return function (this: any, ...args: any[]) {
    if (!warned) {
      console.warn(msg);
      warned = true;
    }
    return fn.apply(this, args);
  };
}

// inherit - simple prototype inheritance
export function inherits(ctor: any, superCtor: any) {
  ctor.prototype = Object.create(superCtor.prototype, {
    constructor: { value: ctor, enumerable: false, writable: true, configurable: true },
  });
}

// promisify - not implemented in browser
export function promisify() {
  throw new Error('util.promisify not available in browser');
}

export const types = {
  isDate: (v: any) => v instanceof Date,
  isRegExp: (v: any) => v instanceof RegExp,
  isArgumentsObject: (v: any) => Object.prototype.toString.call(v) === '[object Arguments]',
  isArrayBuffer: (v: any) => v instanceof ArrayBuffer,
  isAsyncFunction: () => false,
  isBigIntObject: (v: any) => typeof v === 'bigint' || v instanceof BigInt,
  isBooleanObject: (v: any) => typeof v === 'boolean' || v instanceof Boolean,
  isDataView: (v: any) => v instanceof DataView,
  isGeneratorFunction: () => false,
  isGeneratorObject: () => false,
  isMap: (v: any) => v instanceof Map,
  isMapIterator: () => false,
  isModuleNamespaceObject: () => false,
  isNativeError: (v: any) => v instanceof Error,
  isNumberObject: (v: any) => typeof v === 'number' || v instanceof Number,
  isPromise: (v: any) => v && typeof v.then === 'function',
  isProxy: () => false,
  isSet: (v: any) => v instanceof Set,
  isSetIterator: () => false,
  isSharedArrayBuffer: (v: any) => false,
  isStringObject: (v: any) => typeof v === 'string' || v instanceof String,
  isSymbolObject: (v: any) => typeof v === 'symbol' || v instanceof Symbol,
  isTypedArray: (v: any) => ArrayBuffer.isView(v) && !(v instanceof DataView),
  isWeakMap: (v: any) => v instanceof WeakMap,
  isWeakSet: (v: any) => v instanceof WeakSet,
  isAnyArrayBuffer: (v: any) => v instanceof ArrayBuffer || (typeof SharedArrayBuffer !== 'undefined' && v instanceof SharedArrayBuffer),
  isArrayBufferView: (v: any) => ArrayBuffer.isView(v),
  isFloat32Array: (v: any) => v instanceof Float32Array,
  isFloat64Array: (v: any) => v instanceof Float64Array,
  isInt8Array: (v: any) => v instanceof Int8Array,
  isInt16Array: (v: any) => v instanceof Int16Array,
  isInt32Array: (v: any) => v instanceof Int32Array,
  isUint8Array: (v: any) => v instanceof Uint8Array,
  isUint8ClampedArray: (v: any) => v instanceof Uint8ClampedArray,
  isUint16Array: (v: any) => v instanceof Uint16Array,
  isUint32Array: (v: any) => v instanceof Uint32Array,
  isBigInt64Array: (v: any) => v instanceof BigInt64Array,
  isBigUint64Array: (v: any) => v instanceof BigUint64Array,
};

// Default export
const util = {
  debuglog,
  inspect,
  format,
  isArray,
  isBoolean,
  isNull,
  isNullOrUndefined,
  isNumber,
  isString,
  isSymbol,
  isUndefined,
  isRegExp,
  isObject,
  isDate,
  isError,
  isFunction,
  isPrimitive,
  isBuffer,
  isArrayBuffer,
  isDataView,
  isMap,
  isSet,
  isWeakMap,
  isWeakSet,
  isPromise,
  isGeneratorFunction,
  isGeneratorObject,
  isAsyncFunction,
  isExternal,
  deprecate,
  inherits,
  promisify,
  types,
};

export default util;