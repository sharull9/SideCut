// Repository Electron acceptance workflow: build:desktop and dev server :4270.
import { app, BrowserWindow } from "electron";
import { mkdtempSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "../..");
const profile = mkdtempSync(join(tmpdir(), "sidecut-export-stress-"));
app.setPath("userData", profile);
app.setAppPath(join(root, "apps/desktop"));
process.env.SIDECUT_RENDERER_URL = "http://127.0.0.1:4270";
const require = createRequire(join(root, "apps/desktop/package.json"));
const modulePath = (path) => "/@fs/" + root.replaceAll("\\", "/") + path;
let exitCode = 0;
async function verify() {
  let sampler;
  try {
    await import("../../apps/desktop/dist/main.mjs");
    await app.whenReady();
    let window;
    const deadline = Date.now() + 30000;
    while (!window && Date.now() < deadline) {
      window = BrowserWindow.getAllWindows()[0];
      if (!window) await new Promise((done) => setTimeout(done, 100));
    }
    assert.ok(window, "Editor window did not open");
    const hidden = process.argv.includes("--hidden-probe") || process.argv.includes("--hidden");
    if (hidden) window.hide();
    if (process.argv.includes("--unthrottled")) window.webContents.setBackgroundThrottling(false);
    const results = [];
    for (const [width, height, duration] of process.argv.includes("--hidden-probe")
      ? [[320, 180, 1]]
      : [
          [320, 180, 300],
          [3840, 2160, 30],
        ]) {
      let peakWorkingSetMiB = 0;
      sampler = setInterval(() => {
        peakWorkingSetMiB = Math.max(
          peakWorkingSetMiB,
          app.getAppMetrics().reduce((sum, metric) => sum + metric.memory.workingSetSize / 1024, 0),
        );
      }, 1000);
      const began = performance.now();
      console.log(JSON.stringify({ starting: { width, height, duration } }));
      const result = await window.webContents.executeJavaScript(
        `(async()=>{
        const {renderWebM}=await import(${JSON.stringify(modulePath("/packages/platform-browser/src/export.ts"))});
        const {decodeProjectFile}=await import(${JSON.stringify(modulePath("/packages/contracts/src/project.ts"))});
        const duration=${duration};
        const wav=new ArrayBuffer(44+48000*2),view=new DataView(wav);
        for(const [at,label] of [[0,'RIFF'],[8,'WAVE'],[12,'fmt '],[36,'data']])for(let i=0;i<label.length;i++)view.setUint8(at+i,label.charCodeAt(i));
        view.setUint32(4,wav.byteLength-8,true);view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,48000,true);view.setUint32(28,96000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);view.setUint32(40,96000,true);
        for(let i=0;i<48000;i++)view.setInt16(44+i*2,Math.round(5000*Math.sin(i*2*Math.PI*440/48000)),true);
        const file=new File([wav],'tone.wav',{type:'audio/wav'});
        const project=decodeProjectFile({revision:0,project:{id:'stress',settings:{width:${width},height:${height}},media:[{id:'tone',path:'tone.wav',kind:'audio',duration:1,hasAudio:true}],videoTracks:[{id:'v',kind:'video',clips:[{id:'solid',duration,content:{solid:{color:{r:0.2,g:0.4,b:0.7,a:1}}}}]}],audioTracks:[{id:'a',kind:'audio',clips:[{id:'sound',duration:1,content:{media:{mediaID:'tone'}}}]}]}}).project;
        let last=0,updates=0;window.stressProgress=0;
        const output=await renderWebM(project,async()=>({file,state:'available',detail:'fixture'}),new AbortController().signal,value=>{if(value<last)throw new Error('Export progress went backward');last=value;window.stressProgress=value;updates++},{fullResolution:true,bitrate:20000000});
        const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(output)});
        return {data,bytes:output.size,lastProgress:last,progressUpdates:updates};
      })()`,
        true,
      );
      clearInterval(sampler);
      sampler = undefined;
      const elapsedSeconds = (performance.now() - began) / 1000;
      if (process.argv.includes("--hidden-probe"))
        assert.ok(
          elapsedSeconds < 10,
          `One-second hidden export took ${elapsedSeconds.toFixed(1)}s`,
        );
      const path = join(profile, `${width}x${height}-${duration}.webm`);
      await writeFile(path, Buffer.from(result.data, "base64"));
      const probe = spawnSync(
        require("ffprobe-static").path,
        ["-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", path],
        { windowsHide: true, encoding: "utf8", timeout: 120000 },
      );
      assert.equal(probe.status, 0, probe.stderr);
      const info = JSON.parse(probe.stdout),
        video = info.streams.find((stream) => stream.codec_type === "video"),
        audio = info.streams.find((stream) => stream.codec_type === "audio");
      assert.equal(video.width, width);
      assert.equal(video.height, height);
      assert.equal(Number(video.nb_read_frames), duration * 30);
      assert.ok(Math.abs(Number(info.format.duration) - duration) < 0.05);
      assert.equal(video.codec_name, "vp8");
      assert.equal(audio.codec_name, "opus");
      assert.equal(audio.sample_rate, "48000");
      assert.equal(audio.channels, 2);
      assert.equal(result.lastProgress, 1);
      assert.ok(result.progressUpdates >= duration * 30);
      results.push({
        width,
        height,
        duration: info.format.duration,
        frames: Number(video.nb_read_frames),
        bytes: result.bytes,
        elapsedSeconds,
        peakWorkingSetMiB,
        progressUpdates: result.progressUpdates,
      });
      console.log(JSON.stringify(results.at(-1)));
    }
    const evidence = {
      testedAt: new Date().toISOString(),
      platform: process.platform,
      hidden,
      backgroundThrottling: window.webContents.getBackgroundThrottling(),
      results,
      limits: [
        "Synthetic static solid picture and one-second tone followed by silence",
        process.argv.includes("--hidden-probe")
          ? "One-second hidden-window regression, not a long stress run"
          : "Five-minute 320x180 and thirty-second 4K tests, not five minutes at 4K",
        "Working set sums this Electron app's processes at one-second intervals; not a memory guarantee",
        "No native Tandem golden, complex effects, source-video decoding stress or other platform acceptance",
      ],
    };
    await writeFile(
      join(
        root,
        process.argv.includes("--hidden-probe")
          ? "docs/verification/export-hidden-probe-runtime.json"
          : "docs/verification/export-stress-runtime.json",
      ),
      JSON.stringify(evidence, null, 2) + "\n",
    );
  } catch (error) {
    exitCode = 1;
    console.error(error);
  } finally {
    clearInterval(sampler);
    app.once("will-quit", () => app.exit(exitCode));
    app.quit();
  }
}
void verify();
