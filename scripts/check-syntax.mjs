import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const IGNORE_DIRS = new Set(['.git', 'node_modules']);
const CHECK_EXTENSIONS = new Set(['.js', '.mjs']);

function collectJavaScriptFiles(dir) {
    const files = [];
    for (const entry of readdirSync(dir)) {
        if (IGNORE_DIRS.has(entry)) continue;

        const fullPath = join(dir, entry);
        const stat = statSync(fullPath);
        if (stat.isDirectory()) {
            files.push(...collectJavaScriptFiles(fullPath));
            continue;
        }

        const extension = entry.slice(entry.lastIndexOf('.'));
        if (CHECK_EXTENSIONS.has(extension)) {
            files.push(fullPath);
        }
    }
    return files;
}

const files = collectJavaScriptFiles(ROOT);
for (const file of files) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

console.log(`Syntax check passed: ${files.length} JavaScript files`);
