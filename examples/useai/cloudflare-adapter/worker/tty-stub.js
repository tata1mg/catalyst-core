// workerd's nodejs_compat has no node:tty. The `debug` package (pulled in by
// finalhandler/express) only uses isatty for color detection, so a false stub is enough.
export const isatty = () => false
export class ReadStream {}
export class WriteStream {}
export default { isatty, ReadStream, WriteStream }
