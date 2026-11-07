// Builds single-file versions of the app into dist/:
//   dist/landmarker2d.html  standalone page (CSS and JS inlined) to email or put on a course site
//   dist/artifact.html      the same content without the <html>/<head>/<body> wrapper, for a claude.ai artifact
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('..', import.meta.url);
const read = p => readFile(new URL(p, root), 'utf8');

const html = await read('index.html');
const css = await read('src/styles.css');
const { version } = JSON.parse(await read('package.json'));

const guardScript = s => s.replace(/<\/script/gi, '<\\/script');
let page = html
  .replace('<link rel="stylesheet" href="src/styles.css">', () => `<style>\n${css}</style>`)
  .replace('<head>', `<head>\n<!-- landmarker2D ${version} single-file build -->`);
// inline every <script src="src/…"> in page order
for (const [tag, file] of [...page.matchAll(/<script src="(src\/[\w.-]+\.js)"><\/script>/g)]) {
  const js = await read(file);
  page = page.replace(tag, () => `<script>\n${guardScript(js)}</script>`);
}
if (/(href|src)="src\//.test(page)) throw new Error('build: a source file was not inlined');

const head = page.match(/<head>([\s\S]*?)<\/head>/)[1]
  .replace(/<meta charset[^>]*>\s*/i, '')
  .replace(/<meta name="viewport"[^>]*>\s*/i, '');
const body = page.match(/<body>([\s\S]*?)<\/body>/)[1];
const artifact = head.trim() + '\n' + body.trim() + '\n';

await mkdir(new URL('dist/', root), { recursive: true });
await writeFile(new URL('dist/landmarker2d.html', root), page);
await writeFile(new URL('dist/artifact.html', root), artifact);
console.log(`Built ${fileURLToPath(new URL('dist/landmarker2d.html', root))} (${(page.length / 1024).toFixed(0)} KB) and dist/artifact.html`);
