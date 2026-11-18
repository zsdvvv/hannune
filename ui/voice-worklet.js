// 폰 앱에서 쓰는 소리 수집 노드: 받은 소리를 그대로 넘긴다(계산은 voicecore.js).
class HnCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('hn-capture', HnCapture);
