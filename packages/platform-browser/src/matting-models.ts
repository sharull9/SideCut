export type MattingBackend = "mediapipe" | "rvm";
export const RVM_MODEL = {
  url: "https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx",
  sha256: "88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828",
  version: "matte:rvm-mobilenetv3-fp32:1:1280x720:s0.375",
};
export function mattingInput(rgba: Uint8ClampedArray, width: number, height: number) {
  const pixels = width * height;
  if (rgba.length !== pixels * 4) throw new Error("Invalid matting input dimensions.");
  const rgb = new Float32Array(pixels * 3);
  for (let i = 0; i < pixels; i++)
    for (let c = 0; c < 3; c++) rgb[c * pixels + i] = rgba[i * 4 + c]! / 255;
  return rgb;
}
export function mattingOutput(alpha: Float32Array) {
  const rgba = new Uint8ClampedArray(alpha.length * 4);
  for (let i = 0; i < alpha.length; i++) {
    if (!Number.isFinite(alpha[i])) throw new Error("Matting model returned invalid alpha.");
    const value = Math.round(Math.max(0, Math.min(1, alpha[i]!)) * 255);
    rgba[i * 4] = rgba[i * 4 + 1] = value;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}
