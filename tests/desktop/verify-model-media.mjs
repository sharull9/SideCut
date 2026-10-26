import assert from "node:assert/strict";
import { app, BrowserWindow } from "electron";
import { writeFile, readFile } from "node:fs/promises";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir, homedir } from "node:os";
import { join, resolve } from "node:path";
async function verify() {
  const root = resolve(import.meta.dirname, "../..");
  const temp = mkdtempSync(join(tmpdir(), "sidecut-model-media-"));
  mkdirSync(join(temp, "profile"));
  const project = join(temp, "test.tandem");
  writeFileSync(project, JSON.stringify({ revision: 0, project: { id: "model-media" } }));
  app.setAppPath(join(root, "apps/desktop"));
  for (const [key, value] of Object.entries({
    "headless-project": project,
    "headless-profile": join(temp, "profile"),
    "headless-storage-root": join(temp, "storage"),
    "headless-parent": String(process.pid),
  }))
    app.commandLine.appendSwitch(key, value);
  process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
  const results = { platform: process.platform };
  let exitCode = 0;
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    let window;
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      window = BrowserWindow.getAllWindows()[0];
      if (
        window &&
        (await window.webContents
          .executeJavaScript("Boolean(document.querySelector('.editor-workspace'))")
          .catch(() => false))
      )
        break;
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.ok(window);
    const evaluate = (code) => window.webContents.executeJavaScript(code, true);
    const path = "/@fs/" + root.replaceAll("\\", "/");
    const model = (
      await readFile(
        process.env.SIDECUT_RVM_MODEL ??
          join(homedir(), ".cache/sidecut-models/rvm_mobilenetv3_fp32.onnx"),
      )
    ).toString("base64");
    const picture = (
      await readFile(join(root, "tests/fixtures/cutout/person-microphone.jpg"))
    ).toString("base64");
    process.stdout.write("Testing official RVM inference...\n");
    results.matting = await evaluate(`(async()=>{
    const base=${JSON.stringify(path)};
    const {derivedCache}=await import(base+'/packages/platform-browser/src/derived-cache.ts');
    const {RVM_MODEL}=await import(base+'/packages/platform-browser/src/matting-models.ts');
    const bytes=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
    await derivedCache(RVM_MODEL.version+':model',bytes(${JSON.stringify(model)}).buffer);
    const {analyseCutout}=await import(base+'/packages/platform-browser/src/cutout.ts');
    const {readFrame}=await import(base+'/packages/platform-browser/src/frame-store.ts');
    const file=new File([bytes(${JSON.stringify(picture)})],'person.jpg',{type:'image/jpeg'});
    const matte=await analyseCutout(file,'image',1,new AbortController().signal,()=>{},'rvm');
    const bitmap=await createImageBitmap(await readFrame(matte.frames[0].image));
    const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let background=0,foreground=0,soft=0;
    for(let i=0;i<pixels.length;i+=4){if(pixels[i]<10)background++;else if(pixels[i]>245)foreground++;else soft++;}
    if(!background||!foreground||!soft)throw Error('RVM did not produce foreground, background and soft alpha');
    return {backend:matte.backend,width:matte.width,height:matte.height,frames:matte.frames.length,diskFrames:'frameFile' in matte.frames[0].image,background,foreground,soft};
  })()`);
    process.stdout.write("Testing long and high frame rate exports...\n");
    results.exports = await evaluate(`(async()=>{
    const base=${JSON.stringify(path)}, {decodeProjectFile}=await import(base+'/packages/contracts/src/project.ts');
    const {renderWebM}=await import(base+'/packages/platform-browser/src/export.ts');
    const {diskExport,releaseExport}=await import(base+'/packages/platform-browser/src/export-output.ts');
    const result=[];
    for(const [duration,fps] of [[301,1],[1,120]]){
      const project=decodeProjectFile({revision:0,project:{id:'export',settings:{width:64,height:36,frameRate:{numerator:fps,denominator:1}},videoTracks:[{id:'v',kind:'video',clips:[{id:'solid',duration,content:{solid:{color:{r:0.1,g:0.4,b:0.7,a:1}}}}]}]}}).project;
      const blob=await renderWebM(project,async()=>null,new AbortController().signal,()=>{});
      const {LocalMediaReader}=await import(base+'/packages/platform-browser/src/preview.ts');
      const file=new File([blob],'export.webm',{type:'video/webm'}),reader=await LocalMediaReader.open(file,'video');
      let actualDuration=0,frameCount=0;
      for await(const frame of reader.frames()){frameCount++;actualDuration=Math.max(actualDuration,frame.timestamp+frame.duration);}reader.close();
      if(frameCount!==duration*fps)throw Error('Frame count mismatch: '+frameCount);
      if(Math.abs(actualDuration-duration)>0.02)throw Error('Export duration mismatch: '+actualDuration);
      const entry={duration,fps,actualDuration,frameCount,bytes:blob.size,fileBacked:diskExport(blob),type:blob.type};
      if(duration>300){
        const {generateProxy}=await import(base+'/packages/platform-browser/src/proxy.ts');
        
        const proxy=await generateProxy(file,{kind:'video',duration:{seconds:duration}},new AbortController().signal,()=>{});
        if(proxy.frames.length!==301||!('frameFile' in proxy.frames[0].image))throw Error('Long proxy frames missing');
        entry.proxyFrames=proxy.frames.length;
        const {analyseCutout}=await import(base+'/packages/platform-browser/src/cutout.ts');
        const matte=await analyseCutout(file,'video',duration,new AbortController().signal,()=>{},'rvm');
        if(matte.frames.length!==301)throw Error('Long recurrent matte frames missing');
        entry.matteFrames=matte.frames.length;
      }
      result.push(entry);
      if(duration>300&&!diskExport(blob))throw Error('Long export was not file backed');
      await releaseExport(blob);
    }
    return result;
  })()`);
    await writeFile(
      join(root, "docs/verification/model-media-runtime.json"),
      JSON.stringify(results, null, 2) + "\n",
    );
    process.stdout.write(JSON.stringify(results) + "\n");
  } catch (error) {
    exitCode = 1;
    process.stderr.write(String(error.stack) + "\n");
    process.exitCode = 1;
  } finally {
    app.exit(exitCode);
  }
}
void verify();
