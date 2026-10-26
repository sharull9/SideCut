// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const profile = mkdtempSync(join(tmpdir(), "sidecut-render-quality-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
let exitCode = 0;
const require = createRequire(join(root, "apps/desktop/package.json"));
const ffmpeg = require("ffmpeg-static");
const fixture = join(profile, "detail.webm");
const encoded = spawnSync(
  ffmpeg,
  [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "nullsrc=s=3840x2160:r=30,geq=lum='if(mod(X,2),235,16)':cb=128:cr=128",
    "-frames:v",
    "3",
    "-c:v",
    "libvpx-vp9",
    "-lossless",
    "1",
    "-threads",
    "2",
    fixture,
  ],
  { windowsHide: true, timeout: 60000, encoding: "utf8" },
);
assert.equal(encoded.status, 0, encoded.stderr);
async function verify() {
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    const source = (await readFile(fixture)).toString("base64");
    const wav = Buffer.alloc(44 + 480480 * 4);
    wav.write("RIFF");
    wav.writeUInt32LE(wav.length - 8, 4);
    wav.write("WAVEfmt ", 8);
    wav.writeUInt32LE(16, 16);
    wav.writeUInt16LE(1, 20);
    wav.writeUInt16LE(2, 22);
    wav.writeUInt32LE(48000, 24);
    wav.writeUInt32LE(192000, 28);
    wav.writeUInt16LE(4, 32);
    wav.writeUInt16LE(16, 34);
    wav.write("data", 36);
    wav.writeUInt32LE(wav.length - 44, 40);
    for (let frame = 0; frame < 480480; frame++)
      for (let channel = 0; channel < 2; channel++)
        wav.writeInt16LE(
          Math.round(Math.sin((frame * 2 * Math.PI * (channel ? 880 : 440)) / 48000) * 5000),
          44 + frame * 4 + channel * 2,
        );
    let window;
    const deadline = Date.now() + 30000;
    while (!window && Date.now() < deadline) {
      window = BrowserWindow.getAllWindows()[0];
      if (!window) await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(window, "Editor window did not open");
    await window.webContents.executeJavaScript(
      `(async()=>{
    const {renderService}=await import('/src/modules/workspace/service-render.ts');
    const {decodeProjectFile}=await import(${JSON.stringify("/@fs/" + root.replaceAll("\\", "/") + "/packages/contracts/src/project.ts")});
    const project=decodeProjectFile({revision:0,project:{id:'quality',settings:{width:3840,height:2160},media:[{id:'detail',path:'detail.webm',kind:'video',duration:0.1}],videoTracks:[{id:'v',kind:'video',clips:[{id:'picture',duration:0.1,content:{media:{mediaID:'detail'}}}]}]}}).project;
    const file=new File([Uint8Array.from(atob(${JSON.stringify(source)}),c=>c.charCodeAt(0))],'detail.webm',{type:'video/webm'});
    const session={getSnapshot:()=>({project}),resource:async()=>({file,state:'available',detail:'fixture'}),analysis:{getSnapshot:()=>({})}};
    const result=await renderService(session,'frame',{time:0,maxWidth:3840,maxHeight:2160},new AbortController().signal);
    const image=await createImageBitmap(await (await fetch('data:image/png;base64,'+result.png)).blob());
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();
    const row=ctx.getImageData(100,100,100,1).data;
    let contrast=0;for(let x=1;x<100;x++)contrast+=Math.abs(row[x*4]-row[(x-1)*4]);
    window.renderQuality={width:canvas.width,height:canvas.height,adjacentContrast:contrast/99};
    const encoded=await renderService(session,'export',{preset:'webm',from:0,to:0.1},new AbortController().signal);
    window.detailExport=encoded;
    const {renderWebM}=await import(${JSON.stringify("/@fs/" + root.replaceAll("\\", "/") + "/packages/platform-browser/src/export.ts")});
    const voice=new File([Uint8Array.from(atob(${JSON.stringify(wav.toString("base64"))}),c=>c.charCodeAt(0))],'stereo.wav',{type:'audio/wav'});
    const timed=decodeProjectFile({revision:0,project:{id:'timed',settings:{width:1280,height:720,frameRate:{numerator:30000,denominator:1001}},media:[{id:'voice',path:'stereo.wav',kind:'audio',duration:10.01,hasAudio:true}],videoTracks:[{id:'v',kind:'video',clips:[{id:'solid',duration:10.01,content:{solid:{color:{r:0.2,g:0.4,b:0.8,a:1}}}}]}],audioTracks:[{id:'a',kind:'audio',clips:[{id:'sound',duration:10.01,content:{media:{mediaID:'voice'}}}]}]}}).project;
    const resource=async()=>({file:voice,state:'available',detail:'fixture'});
    const cancel=new AbortController();let framesBeforeCancel=0;
    try {
      await renderWebM(timed,resource,cancel.signal,p=>{framesBeforeCancel++;if(p>=0.02)cancel.abort()}, {fullResolution:true});
      throw new Error('Cancelled export unexpectedly completed');
    } catch(error) { if(error.name!=='AbortError')throw error; }
    window.cancellation={framesBeforeCancel,aborted:cancel.signal.aborted};
    window.timedExport=await renderService({getSnapshot:()=>({project:timed}),resource,analysis:{getSnapshot:()=>({})}},'export',{preset:'webm',from:3.003,to:8.008},new AbortController().signal);
    window.fractionalExport=await renderService({getSnapshot:()=>({project:timed}),resource,analysis:{getSnapshot:()=>({})}},'export',{preset:'webm',from:1001/30000,to:51*1001/30000},new AbortController().signal);
    const late=decodeProjectFile({revision:0,project:{id:'late',media:[{id:'voice',path:'stereo.wav',kind:'audio',duration:10.01,hasAudio:true}],audioTracks:[{id:'a',kind:'audio',clips:[{id:'sound',start:600,duration:1,content:{media:{mediaID:'voice'}}}]}]}}).project;
    const lateWav=await renderService({getSnapshot:()=>({project:late}),resource,analysis:{getSnapshot:()=>({})}},'clip',{start:600,end:601,audioOnly:true},new AbortController().signal);
    const lateBytes=Uint8Array.from(atob(lateWav.data),c=>c.charCodeAt(0));
    window.lateAudio={duration:lateWav.duration,bytes:lateBytes.length,nonSilent:lateBytes.subarray(44).some(x=>x!==0)};
    const scoped=decodeProjectFile({revision:0,project:{id:'scoped',settings:{width:320,height:180},media:[{id:'missing',path:'gone.webm',kind:'video',duration:1}],videoTracks:[{id:'v',kind:'video',clips:[{id:'ok',duration:1,content:{solid:{color:{r:0,g:0.5,b:1,a:1}}}},{id:'missing',start:2,duration:1,content:{media:{mediaID:'missing'}}},{id:'unsupported',start:600,duration:1,content:{graphic:{template:'unsupported'}}}]}]}}).project;
    let unusedReads=0;
    const scopedOutput=await renderService({getSnapshot:()=>({project:scoped}),resource:async()=>{unusedReads++;return null},analysis:{getSnapshot:()=>({})}},'export',{preset:'webm',from:0,to:1},new AbortController().signal);
    const handles=decodeProjectFile({revision:0,project:{id:'handles',settings:{width:320,height:180},media:[{id:'detail',path:'detail.webm',kind:'video',duration:0.1},{id:'missing',path:'gone.webm',kind:'video',duration:1}],videoTracks:[{id:'v',kind:'video',clips:[{id:'left',duration:1,content:{media:{mediaID:'detail'}}},{id:'right',start:1,duration:1,content:{media:{mediaID:'missing'}}}],transitions:[{id:'cut',type:'dissolve',duration:0.4,fromClipID:'left',toClipID:'right'}]}]}}).project;
    let handleFailure='';
    try {await renderWebM(handles,async id=>id==='detail'?{file,state:'available',detail:'fixture'}:null,new AbortController().signal,()=>{},{start:0.9,end:1,fullResolution:true});}
    catch(error){handleFailure=error.message;}
    window.scopedRange={duration:scopedOutput.duration,bytes:scopedOutput.bytes,unusedReads,handleFailure};
  })()`,
      true,
    );
    const detail = await window.webContents.executeJavaScript("window.renderQuality");
    assert.equal(detail.width, 3840);
    assert.equal(detail.height, 2160);
    assert.ok(
      detail.adjacentContrast > 150,
      `4K one-pixel detail was lost: contrast ${detail.adjacentContrast}`,
    );
    const detailExport = await window.webContents.executeJavaScript("window.detailExport");
    const detailPath = join(profile, "detail-output.webm");
    await writeFile(detailPath, Buffer.from(detailExport.data, "base64"));
    const decoded = spawnSync(
      ffmpeg,
      [
        "-v",
        "error",
        "-i",
        detailPath,
        "-frames:v",
        "1",
        "-vf",
        "crop=100:2:100:100,format=gray",
        "-f",
        "rawvideo",
        "-",
      ],
      { windowsHide: true, timeout: 30000 },
    );
    assert.equal(decoded.status, 0, decoded.stderr.toString());
    let encodedContrast = 0;
    for (let x = 1; x < 100; x++)
      encodedContrast += Math.abs(decoded.stdout[x] - decoded.stdout[x - 1]);
    encodedContrast /= 99;
    assert.ok(encodedContrast > 150, `Encoded 4K detail lost: ${encodedContrast}`);
    const timedExport = await window.webContents.executeJavaScript("window.timedExport");
    const timedPath = join(profile, "timed-output.webm");
    await writeFile(timedPath, Buffer.from(timedExport.data, "base64"));
    const probe = spawnSync(
      require("ffprobe-static").path,
      ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", timedPath],
      { encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    assert.equal(probe.status, 0, probe.stderr);
    const info = JSON.parse(probe.stdout),
      video = info.streams.find((s) => s.codec_type === "video"),
      audio = info.streams.find((s) => s.codec_type === "audio");
    assert.equal(video.nb_read_frames, "150");
    assert.equal(video.width, 1280);
    assert.equal(video.height, 720);
    assert.ok(Math.abs(Number(info.format.duration) - 5.005) < 0.05);
    assert.equal(audio.channels, 2);
    assert.equal(audio.sample_rate, "48000");
    assert.ok(Number.isFinite(timedExport.integratedLUFS));
    assert.ok(Math.abs(timedExport.integratedLUFS + 14) < 1);
    const meter = spawnSync(
      ffmpeg,
      ["-hide_banner", "-nostats", "-i", timedPath, "-af", "ebur128=peak=true", "-f", "null", "-"],
      { encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    assert.equal(meter.status, 0, meter.stderr);
    const summary = meter.stderr.split("Summary:").at(-1) ?? "";
    const integrated = /Integrated loudness:\s+I:\s+(-?[\d.]+) LUFS/.exec(summary);
    const peak = /True peak:\s+Peak:\s+(-?[\d.]+) dBFS/.exec(summary);
    assert.ok(integrated && peak, "FFmpeg did not report decoded audio levels");
    const independentLevels = {
      integratedLUFS: Number(integrated[1]),
      truePeakDBTP: Number(peak[1]),
      meter: "FFmpeg ebur128 on decoded Opus",
    };
    assert.ok(Math.abs(independentLevels.integratedLUFS - timedExport.integratedLUFS) < 0.5);
    assert.ok(Math.abs(independentLevels.truePeakDBTP - timedExport.truePeakDBTP) < 0.5);
    const cancellation = await window.webContents.executeJavaScript("window.cancellation");
    assert.ok(cancellation.aborted && cancellation.framesBeforeCancel > 1);
    const fractional = await window.webContents.executeJavaScript("window.fractionalExport");
    const fractionalPath = join(profile, "fractional-output.webm");
    await writeFile(fractionalPath, Buffer.from(fractional.data, "base64"));
    const fractionalProbe = spawnSync(
      require("ffprobe-static").path,
      [
        "-v",
        "error",
        "-count_frames",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        fractionalPath,
      ],
      { encoding: "utf8", windowsHide: true, timeout: 30000 },
    );
    assert.equal(fractionalProbe.status, 0, fractionalProbe.stderr);
    const fractionalInfo = JSON.parse(fractionalProbe.stdout);
    assert.equal(fractionalInfo.streams.find((s) => s.codec_type === "video").nb_read_frames, "50");
    assert.ok(Math.abs(Number(fractionalInfo.format.duration) - (50 * 1001) / 30000) < 0.05);
    const lateAudio = await window.webContents.executeJavaScript("window.lateAudio");
    assert.deepEqual(lateAudio, { duration: 1, bytes: 192044, nonSilent: true });
    const scopedRange = await window.webContents.executeJavaScript("window.scopedRange");
    assert.equal(scopedRange.duration, 1);
    assert.ok(scopedRange.bytes > 100);
    assert.equal(scopedRange.unusedReads, 0);
    assert.match(scopedRange.handleFailure, /gone.webm.*missing/);
    const evidence = {
      testedAt: new Date().toISOString(),
      platform: process.platform,
      detail,
      encodedDetail: {
        width: detailExport.width,
        height: detailExport.height,
        adjacentContrast: encodedContrast,
        bytes: detailExport.bytes,
      },
      timed: {
        start: 3.003,
        end: 8.008,
        frames: video.nb_read_frames,
        duration: info.format.duration,
        frameRate: video.r_frame_rate,
        channels: audio.channels,
        sampleRate: audio.sample_rate,
        integratedLUFS: timedExport.integratedLUFS,
        truePeakDBTP: timedExport.truePeakDBTP,
      },
      cancellation,
      independentLevels,
      fractionalRange: {
        from: 1001 / 30000,
        to: (51 * 1001) / 30000,
        frames: 50,
        duration: fractionalInfo.format.duration,
      },
      lateAudio,
      scopedRange,
      limits: [
        "Three-frame 4K stripe fixture and five-second 720p stereo range",
        "No upstream golden or long-duration stress comparison",
      ],
    };
    await writeFile(
      join(root, "docs/verification/render-quality-runtime.json"),
      JSON.stringify(evidence, null, 2) + "\n",
    );
    console.log(JSON.stringify(evidence));
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    app.once("will-quit", () => app.exit(exitCode));
    app.quit();
  }
}
void verify();
