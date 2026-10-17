import 'react-native-get-random-values';
import { encode, decode } from 'base-64';
import 'fast-text-encoding';

const _global = globalThis as any;
if (!_global.btoa) _global.btoa = encode;
if (!_global.atob) _global.atob = decode;
