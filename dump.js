import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const IGNORE_DIRS = ["node_modules", ".git", "dist", "build", ".next", "out"];
const IGNORE_FILES = [
  "package.json",
  "package-lock.json",
  "postcss.config.js",
  "tailwind.config.js",
  "README.md",
  "eslint.config.js",
  "vite.config.js"
];

const baseDir = process.argv[2] || ".";

function dumpFolderStructure(dirPath, relativePath = "") {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    const relPath = path.join(relativePath, file);
    const stats = fs.statSync(fullPath);

    if (stats.isDirectory()) {
      if (!IGNORE_DIRS.includes(file)) {
        dumpFolderStructure(fullPath, relPath);
      }
    } else {
      if (!IGNORE_FILES.includes(file)) {
        const content = fs.readFileSync(fullPath, "utf-8");
        console.log(`${relPath} ==>\n`);
        console.log(content);
        console.log("\n\n");
      }
    }
  });
}

dumpFolderStructure(baseDir);
