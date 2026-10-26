# Local media models

SideCut downloads model weights on first use and stores them in the local derived cache. Model weights are not included in the application package. Changing a backend uses a separate cache key.

## Recurrent video matting

The Cutout inspector offers MediaPipe and Robust Video Matting (RVM). MediaPipe remains the default. RVM carries four recurrent tensors between source frames and uses the model's continuous alpha plane. Both backends write matte frames to local storage.

- Official project: [PeterL1n/RobustVideoMatting](https://github.com/PeterL1n/RobustVideoMatting).
- Model: [MobileNetV3 FP32 ONNX, release v1.0.0](https://github.com/PeterL1n/RobustVideoMatting/releases/download/v1.0.0/rvm_mobilenetv3_fp32.onnx).
- SHA-256: `88d4531297118f595bf2fd60f6f566aec2e559393802d1f436c380f0cbbd2828`. SideCut verifies downloaded and cached model bytes before inference.
- Upstream licence: GPL-3.0. The upstream repository supplies its licence and model usage terms. This optional download is not covered by SideCut's source licence.
- Runtime: ONNX Runtime Web WASM, one thread, maximum input size 1280 by 720, downsample ratio 0.375.
- Reference: [official inference interface](https://github.com/PeterL1n/RobustVideoMatting/blob/master/documentation/inference.md).

Tandem uses a CoreML conversion of the same model family. The browser FP32 path does not establish pixel equality with that conversion. The Windows runtime fixture verifies inference and soft alpha, plus recurrent processing of 301 video frames. It does not measure segmentation quality across a representative video set.

## Multilingual transcription

The transcription selector supports the 99 language codes in the pinned [Xenova/whisper-tiny model](https://huggingface.co/Xenova/whisper-tiny), revision `5332fcc35e32a33b86612b9a57a89be7906102b1`. Transformers.js runs quantized local inference with transcription and word timestamps. Model and language are part of the transcript cache identity. This replaces the English-only model path.

The model repository lists the Apache-2.0 licence. Language configuration and cache separation have automated coverage. Recognition accuracy across all languages has not been measured.

## Voice isolation

SideCut uses RNNoise. Tandem uses Apple's sound isolation processor. Their outputs and performance differ. The presence of the same control does not establish audio quality parity.
