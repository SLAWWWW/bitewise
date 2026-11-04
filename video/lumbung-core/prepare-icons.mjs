import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import sharp from 'sharp';
import { mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('./assets/', import.meta.url));
await mkdir(directory,{recursive:true});
for (const name of ['Package','ShieldCheck','GitBranch','Hand','Truck','ClipboardCheck','FileCheck2','Warehouse','Check','X','ArrowUpRight','Clock3','Layers3']) {
  for(const color of ['white','black']) {
    const svg=renderToStaticMarkup(React.createElement(icons[name], {size:192,strokeWidth:1.45,color}));
    await sharp(Buffer.from(svg)).png().toFile(`${directory}/${name}-${color}.png`);
  }
}
await copyFile(fileURLToPath(new URL('../../node_modules/lucide-react/LICENSE',new URL('../../',import.meta.url))),`${directory}/LUCIDE-LICENSE.txt`).catch(async()=>{
  await copyFile('node_modules/lucide-react/LICENSE',`${directory}/LUCIDE-LICENSE.txt`);
});
console.log('Prepared licensed Lucide icon assets.');
