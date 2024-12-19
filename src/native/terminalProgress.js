import * as pc from 'picocolors';

class TerminalProgress {
    constructor(steps, title = 'Setup Progress', options = {}) {
        this.steps = new Map(
            Object.entries(steps).map(([id, description]) => [
                id,
                {
                    id,
                    description,
                    status: 'pending',
                    error: null
                }
            ])
        );
        this.title = title;
        this.currentStep = null;
        this.isPaused = false;
        this.lineCount = 0;
        this.lastRender = '';
        
        // Default styling options
        this.options = {
            titlePaddingTop: options.titlePaddingTop ?? 1,
            titlePaddingBottom: options.titlePaddingBottom ?? 1,
            stepPaddingLeft: options.stepPaddingLeft ?? 2,
            stepSpacing: options.stepSpacing ?? 0,
            errorPaddingLeft: options.errorPaddingLeft ?? 4,
            bottomMargin: options.bottomMargin ?? 1
        };
    }

    static icons = {
        completed: '✓',
        running: '◆',
        pending: '○',
        error: '✗',
        info: 'ℹ',
        warning: '⚠',
        prompt: '?'
    };

    printTreeContent(title, content) {
        // Add top padding
        console.log('\n'.repeat(this.options.titlePaddingTop));
        
        // Print the title
        console.log(`${pc.cyan(pc.bold(title))}`);
        
        // Process and print each line of content
        for (const line of content) {
            if (typeof line === 'string') {
                console.log(`${' '.repeat(this.options.stepPaddingLeft)}${line}`);
            } else if (typeof line === 'object') {
                const { text, indent = 0, prefix = '', color = 'white' } = line;
                const indentation = ' '.repeat(this.options.stepPaddingLeft + (indent * 3));
                const coloredText = pc[color] ? pc[color](text) : text;
                console.log(`${indentation}${prefix}${coloredText}`);
            }
        }
    }

    start(id) {
        const step = this.steps.get(id);
        if (!step) throw new Error(`Step ${id} not found`);

        this.currentStep = step;
        step.status = 'running';
        this.render();
    }

    complete(id) {
        const step = this.steps.get(id);
        if (!step) throw new Error(`Step ${id} not found`);

        step.status = 'completed';
        if (this.currentStep === step) {
            this.currentStep = null;
        }
        this.render();
    }

    fail(id, error) {
        const step = this.steps.get(id);
        if (!step) throw new Error(`Step ${id} not found`);

        step.status = 'error';
        step.error = error;
        if (this.currentStep === step) {
            this.currentStep = null;
        }
        this.render();
    }

    pause() {
        this.isPaused = true;
        this.render();
        console.log('');
    }

    resume() {
        this.isPaused = false;
        console.log('');
        this.render();
    }

    getStepIcon(step) {
        const icon = TerminalProgress.icons[step.status] || TerminalProgress.icons.pending;
        switch (step.status) {
            case 'completed':
                return pc.green(icon);
            case 'error':
                return pc.red(icon);
            case 'running':
                return pc.blue(icon);
            default:
                return pc.gray(icon);
        }
    }

    clearLines() {
        if (this.lineCount > 0) {
            process.stdout.moveCursor(0, -this.lineCount);
            process.stdout.cursorTo(0);
            process.stdout.clearScreenDown();
        }
    }

    log(message, type = 'info') {
        this.pause();
        
        let icon;
        let color;
        
        switch (type) {
            case 'success':
                icon = TerminalProgress.icons.completed;
                color = pc.green;
                break;
            case 'error':
                icon = TerminalProgress.icons.error;
                color = pc.red;
                break;
            case 'warning':
                icon = TerminalProgress.icons.warning;
                color = pc.yellow;
                break;
            case 'prompt':
                icon = TerminalProgress.icons.prompt;
                color = pc.yellow;
                break;
            default:
                icon = TerminalProgress.icons.info;
                color = pc.blue;
        }

        console.log(`${' '.repeat(this.options.stepPaddingLeft)}${color(icon)} ${message}`);
        this.resume();
    }

    render() {
        if (this.isPaused) return;

        this.clearLines();
        
        let output = '';
        let currentLineCount = 0;

        // Add top padding
        output += '\n'.repeat(this.options.titlePaddingTop);
        currentLineCount += this.options.titlePaddingTop;

        // Render title
        output += `${pc.bold(pc.cyan(this.title))}\n`;
        output += `${pc.gray('─'.repeat(this.title.length))}\n`;
        currentLineCount += 2;

        // Add padding after title
        output += '\n'.repeat(this.options.titlePaddingBottom);
        currentLineCount += this.options.titlePaddingBottom;

        // Render steps
        for (const step of this.steps.values()) {
            const icon = this.getStepIcon(step);
            const description = step.status === 'error' 
                ? pc.red(step.description)
                : step.status === 'completed'
                    ? pc.green(step.description)
                    : step.status === 'running'
                        ? pc.blue(step.description)
                        : pc.gray(step.description);
            
            const stepPadding = ' '.repeat(this.options.stepPaddingLeft);
            output += `${stepPadding}${icon} ${description}\n`;
            currentLineCount++;
            
            if (step.status === 'error' && step.error) {
                const errorPadding = ' '.repeat(this.options.errorPaddingLeft);
                output += `${errorPadding}${pc.red('↳')} ${pc.red(step.error)}\n`;
                currentLineCount++;
            }

            // Add spacing between steps
            if (this.options.stepSpacing > 0) {
                output += '\n'.repeat(this.options.stepSpacing);
                currentLineCount += this.options.stepSpacing;
            }
        }

        // Add bottom margin
        output += '\n'.repeat(this.options.bottomMargin);
        currentLineCount += this.options.bottomMargin;

        if (output !== this.lastRender) {
            process.stdout.write(output);
            this.lastRender = output;
            this.lineCount = currentLineCount;
        }
    }
}

export default TerminalProgress;