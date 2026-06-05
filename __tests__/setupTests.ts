import { TextDecoder, TextEncoder } from 'node:util';
import { ReadableStream, TransformStream, WritableStream } from 'node:stream/web';

(globalThis as any).TextEncoder ||= TextEncoder;
(globalThis as any).TextDecoder ||= TextDecoder;
(globalThis as any).ReadableStream ||= ReadableStream;
(globalThis as any).TransformStream ||= TransformStream;
(globalThis as any).WritableStream ||= WritableStream;
