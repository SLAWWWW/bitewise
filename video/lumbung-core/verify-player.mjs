import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch();
try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(new URL('./preview.html',import.meta.url).href);
  await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
  const before=await page.locator('video').evaluate(v=>({duration:v.duration,width:v.videoWidth,height:v.videoHeight}));
  await page.locator('video').evaluate(async v=>{v.muted=true;await v.play();});
  await page.waitForFunction(()=>document.querySelector('video').currentTime>3);
  for (const t of [13.5,20.7,26.2,35.9,41.5,48.8,54.5,58.7]) {
    await page.locator('video').evaluate((v,t)=>new Promise(resolve=>{v.pause();v.addEventListener('seeked',resolve,{once:true});v.currentTime=t;}),t);
    await page.screenshot({path:fileURLToPath(new URL(`./previews/player-${t}.png`,import.meta.url))});
  }
  const error=await page.locator('video').evaluate(v=>v.error?.message??null);
  if(error||errors.length)throw new Error(JSON.stringify({error,errors}));
  await writeFile(fileURLToPath(new URL('./previews/player-review.json',import.meta.url)),JSON.stringify({...before,playback:'passed',seeking:'passed',browserErrors:errors},null,2));
  console.log('Native browser playback and seeking passed:',before);
}finally{await browser.close();}
