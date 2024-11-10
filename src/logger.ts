const PREFIX = '[CMakeHelper]';

const nativeConsole = {
    log: Function.prototype.bind.call(console.log, console),
    warn: Function.prototype.bind.call(console.warn, console),
    error: Function.prototype.bind.call(console.error, console)
};

export class Logger {
    static log(...args: any[]): void {
        nativeConsole.log(PREFIX, ...args);
    }

    static warn(...args: any[]): void {
        nativeConsole.warn(PREFIX, ...args);
    }

    static error(...args: any[]): void {
        nativeConsole.error(PREFIX, ...args);
    }

    static template(strings: TemplateStringsArray, ...values: any[]): void {
        const message = String.raw({ raw: strings }, ...values);
        nativeConsole.log(PREFIX, message);
    }
}